import { NextResponse, type NextRequest } from "next/server";
import { appUrl, requireEnv, PRODUCT_NAME } from "@/lib/config";
import { encrypt, safeEqual, unsign } from "@/lib/crypto";
import { slackCall } from "@/lib/slack/api";
import { db, getTeam } from "@/lib/db";
import { publishHome } from "@/lib/slack/home";

interface OAuthAccess {
  ok: boolean;
  access_token: string;
  scope: string;
  bot_user_id: string;
  app_id: string;
  team: { id: string; name: string };
  enterprise: { id: string } | null;
  authed_user: { id: string };
}

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state") || "";
  const cookie = req.cookies.get("slack_oauth_state")?.value || "";
  if (req.nextUrl.searchParams.get("error")) return NextResponse.redirect(`${appUrl()}/?install=cancelled`);
  if (!code || !state || !cookie || !safeEqual(state, cookie) || !unsign(state)) {
    return NextResponse.redirect(`${appUrl()}/?install=invalid_state`);
  }

  let access: OAuthAccess;
  try {
    access = await slackCall<OAuthAccess>("oauth.v2.access", null, {
      client_id: requireEnv("SLACK_CLIENT_ID"),
      client_secret: requireEnv("SLACK_CLIENT_SECRET"),
      code,
      redirect_uri: `${appUrl()}/api/slack/oauth`,
    });
  } catch (e) {
    console.error("oauth.v2.access failed", e);
    return NextResponse.redirect(`${appUrl()}/?install=failed`);
  }

  const teamId = access.team.id;
  const existing = await getTeam(teamId);
  let timezone = existing?.timezone || "UTC";
  if (!existing) {
    try {
      const info = await slackCall<{ ok: boolean; user: { tz?: string } }>("users.info", access.access_token, { user: access.authed_user.id });
      timezone = info.user.tz || "UTC";
    } catch {}
  }

  const { error: teamErr } = await db().from("teams").upsert({
    id: teamId,
    name: access.team.name,
    bot_user_id: access.bot_user_id,
    installer_user_id: existing?.installer_user_id || access.authed_user.id,
    timezone,
  });
  const { error: instErr } = await db().from("installations").upsert({
    team_id: teamId,
    bot_token_enc: encrypt(access.access_token),
    scope: access.scope,
    app_id: access.app_id,
    enterprise_id: access.enterprise?.id ?? null,
    updated_at: new Date().toISOString(),
  });
  if (teamErr || instErr) {
    console.error("install save failed", teamErr?.message, instErr?.message);
    return NextResponse.redirect(`${appUrl()}/?install=failed`);
  }

  // Welcome DM + onboarding home tab for the installer.
  try {
    const team = await getTeam(teamId);
    if (team && !existing) {
      const im = await slackCall<{ ok: boolean; channel: { id: string } }>("conversations.open", access.access_token, { users: access.authed_user.id });
      await slackCall("chat.postMessage", access.access_token, {
        channel: im.channel.id,
        text: `Hi! I'm ${PRODUCT_NAME}, your new AI teammate. Open my *Home* tab for a 3-step setup, or just tell me what you need.`,
      });
    }
    if (team) await publishHome(team, access.access_token, access.authed_user.id);
  } catch (e) {
    console.error("welcome failed", e);
  }

  const res = NextResponse.redirect(`${appUrl()}/installed?team=${teamId}&app=${access.app_id}`);
  res.cookies.delete("slack_oauth_state");
  return res;
}
