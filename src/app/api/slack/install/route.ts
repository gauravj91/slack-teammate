import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { SLACK_BOT_SCOPES, appUrl, requireEnv } from "@/lib/config";
import { sign } from "@/lib/crypto";

/** "Add to Slack": start the OAuth v2 install flow. Installing creates the team, no signup form. */
export async function GET() {
  const nonce = randomBytes(16).toString("hex");
  const state = sign(nonce);
  const url = new URL("https://slack.com/oauth/v2/authorize");
  url.searchParams.set("client_id", requireEnv("SLACK_CLIENT_ID"));
  url.searchParams.set("scope", SLACK_BOT_SCOPES.join(","));
  url.searchParams.set("redirect_uri", `${appUrl()}/api/slack/oauth`);
  url.searchParams.set("state", state);
  const res = NextResponse.redirect(url.toString());
  res.cookies.set("slack_oauth_state", state, { httpOnly: true, secure: true, sameSite: "lax", maxAge: 600, path: "/" });
  return res;
}
