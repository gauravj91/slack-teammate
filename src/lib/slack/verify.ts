import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verify a request really came from Slack.
 * https://api.slack.com/authentication/verifying-requests-from-slack
 * basestring = "v0:" + X-Slack-Request-Timestamp + ":" + raw body
 * signature  = "v0=" + hex(HMAC_SHA256(signing_secret, basestring))
 */
export function verifySlackSignature(opts: {
  signingSecret: string;
  rawBody: string;
  timestamp: string | null;
  signature: string | null;
  nowSeconds?: number;
  toleranceSeconds?: number;
}): boolean {
  const { signingSecret, rawBody, timestamp, signature } = opts;
  if (!signingSecret || !timestamp || !signature) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  const now = opts.nowSeconds ?? Math.floor(Date.now() / 1000);
  // Reject replays older than 5 minutes.
  if (Math.abs(now - ts) > (opts.toleranceSeconds ?? 300)) return false;

  const expected = "v0=" + createHmac("sha256", signingSecret).update(`v0:${timestamp}:${rawBody}`).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Read + verify a Next.js Request. Returns the raw body when valid, otherwise null. */
export async function readVerifiedSlackBody(req: Request): Promise<string | null> {
  const rawBody = await req.text();
  const ok = verifySlackSignature({
    signingSecret: process.env.SLACK_SIGNING_SECRET || "",
    rawBody,
    timestamp: req.headers.get("x-slack-request-timestamp"),
    signature: req.headers.get("x-slack-signature"),
  });
  return ok ? rawBody : null;
}
