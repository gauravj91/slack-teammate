import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { appUrl } from "@/lib/config";

/** "Sign in with Slack" via Supabase Auth's Slack (OIDC) provider. */
export async function GET() {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "slack_oidc",
    options: { redirectTo: `${appUrl()}/auth/callback` },
  });
  if (error || !data.url) return NextResponse.redirect(`${appUrl()}/login?error=oauth`);
  return NextResponse.redirect(data.url);
}
