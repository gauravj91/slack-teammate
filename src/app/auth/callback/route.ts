import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { appUrl } from "@/lib/config";
import { db, getTeam, isAdmin } from "@/lib/db";

const TEAM_CLAIM = "https://slack.com/team_id";
const USER_CLAIM = "https://slack.com/user_id";

/**
 * OAuth callback: exchange the code, find which Slack workspace the user belongs to, and link
 * them to that team (members row drives RLS). Only workspaces that installed the app can sign in.
 */
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  if (!code) return NextResponse.redirect(`${appUrl()}/login?error=oauth`);
  const supabase = await supabaseServer();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.user) return NextResponse.redirect(`${appUrl()}/login?error=oauth`);

  // Slack's OpenID claims: prefer a live userInfo call with the provider token, fall back to stored metadata.
  let teamId: string | undefined;
  let slackUserId: string | undefined;
  if (data.session?.provider_token) {
    try {
      const res = await fetch("https://slack.com/api/openid.connect.userInfo", {
        headers: { Authorization: `Bearer ${data.session.provider_token}` },
      });
      const info = await res.json();
      if (info.ok) {
        teamId = info[TEAM_CLAIM];
        slackUserId = info[USER_CLAIM] || info.sub;
      }
    } catch {}
  }
  const meta = (data.user.user_metadata || {}) as Record<string, unknown>;
  const claims = (meta.custom_claims || {}) as Record<string, string>;
  teamId ||= claims[TEAM_CLAIM] || (meta[TEAM_CLAIM] as string | undefined);
  slackUserId ||= claims[USER_CLAIM] || (meta[USER_CLAIM] as string | undefined) || (meta.provider_id as string | undefined) || (meta.sub as string | undefined);

  const team = teamId ? await getTeam(teamId) : null;
  if (!team || !slackUserId) {
    await supabase.auth.signOut();
    return NextResponse.redirect(`${appUrl()}/login?error=not_installed`);
  }

  await db().from("members").upsert({
    auth_user_id: data.user.id,
    team_id: team.id,
    slack_user_id: slackUserId,
    name: (meta.name as string) || (meta.full_name as string) || null,
    email: data.user.email ?? null,
    is_admin: isAdmin(team, slackUserId),
  });
  return NextResponse.redirect(`${appUrl()}/dashboard`);
}
