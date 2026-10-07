import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { verifySlackSignature } from "@/lib/slack/verify";

const secret = "8f742231b10e8888abcd99yyyzzz85a5";
const body = "token=xyzz0WbapA4vBCDEFasx0q6G&team_id=T1DC2JH3J&command=%2Fweather";
const ts = "1531420618";
const sign = (b: string, t: string, s = secret) => "v0=" + createHmac("sha256", s).update(`v0:${t}:${b}`).digest("hex");

describe("verifySlackSignature", () => {
  it("accepts a valid signature", () => {
    expect(verifySlackSignature({ signingSecret: secret, rawBody: body, timestamp: ts, signature: sign(body, ts), nowSeconds: Number(ts) + 10 })).toBe(true);
  });

  it("matches Slack's documented example", () => {
    // From https://api.slack.com/authentication/verifying-requests-from-slack
    const docBody =
      "token=xyzz0WbapA4vBCDEFasx0q6G&team_id=T1DC2JH3J&team_domain=testteamnow&channel_id=G8PSS9T3V&channel_name=foobar&user_id=U2CERLKJA&user_name=roadrunner&command=%2Fwebhook-collect&text=&response_url=https%3A%2F%2Fhooks.slack.com%2Fcommands%2FT1DC2JH3J%2F397700885554%2F96rGlfmibIGlgcZRskXaIFfN&trigger_id=398738663015.47445629121.803a0bc887a14d10d2c447fce8b6703c";
    expect(
      verifySlackSignature({
        signingSecret: secret,
        rawBody: docBody,
        timestamp: ts,
        signature: "v0=a2114d57b48eac39b9ad189dd8316235a7b4a8d21a10bd27519666489c69b503",
        nowSeconds: Number(ts),
      }),
    ).toBe(true);
  });

  it("rejects a tampered body, wrong secret, missing headers", () => {
    const sig = sign(body, ts);
    expect(verifySlackSignature({ signingSecret: secret, rawBody: body + "x", timestamp: ts, signature: sig, nowSeconds: Number(ts) })).toBe(false);
    expect(verifySlackSignature({ signingSecret: "other", rawBody: body, timestamp: ts, signature: sig, nowSeconds: Number(ts) })).toBe(false);
    expect(verifySlackSignature({ signingSecret: secret, rawBody: body, timestamp: null, signature: sig })).toBe(false);
    expect(verifySlackSignature({ signingSecret: secret, rawBody: body, timestamp: ts, signature: null })).toBe(false);
  });

  it("rejects replays older than 5 minutes", () => {
    expect(verifySlackSignature({ signingSecret: secret, rawBody: body, timestamp: ts, signature: sign(body, ts), nowSeconds: Number(ts) + 301 })).toBe(false);
  });
});
