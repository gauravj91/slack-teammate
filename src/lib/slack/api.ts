/**
 * Minimal Slack Web API client (fetch-based, no extra dependency).
 * Uses application/x-www-form-urlencoded, which every Web API method accepts;
 * object/array arguments (blocks, view) are JSON-encoded.
 */
export type SlackResponse = { ok: boolean; error?: string; [k: string]: unknown };

export class SlackApiError extends Error {
  constructor(public method: string, public code: string) {
    super(`Slack ${method} failed: ${code}`);
  }
}

export async function slackCall<T extends { ok: boolean; error?: string } = SlackResponse>(
  method: string,
  token: string | null,
  args: Record<string, unknown> = {},
): Promise<T> {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(args)) {
    if (v === undefined || v === null) continue;
    body.set(k, typeof v === "string" ? v : JSON.stringify(v));
  }
  const headers: Record<string, string> = { "Content-Type": "application/x-www-form-urlencoded" };
  if (token) headers.Authorization = `Bearer ${token}`;

  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`https://slack.com/api/${method}`, { method: "POST", headers, body });
    if (res.status === 429) {
      const wait = Number(res.headers.get("retry-after") || "1");
      if (wait > 5) throw new SlackApiError(method, "rate_limited"); // don't burn function time
      await new Promise((r) => setTimeout(r, wait * 1000));
      continue;
    }
    const json = (await res.json()) as T;
    if (!json.ok) throw new SlackApiError(method, json.error || `http_${res.status}`);
    return json;
  }
  throw new SlackApiError(method, "rate_limited");
}

/** Convenience wrapper bound to one workspace's bot token. */
export function slackClient(token: string) {
  return {
    call: <T extends { ok: boolean; error?: string } = SlackResponse>(method: string, args?: Record<string, unknown>) =>
      slackCall<T>(method, token, args),
    postMessage: (args: { channel: string; text: string; thread_ts?: string; blocks?: unknown[] }) =>
      slackCall<SlackResponse & { ts: string; channel: string }>("chat.postMessage", token, {
        unfurl_links: false,
        ...args,
      }),
    update: (args: { channel: string; ts: string; text: string; blocks?: unknown[] }) =>
      slackCall("chat.update", token, args),
    postEphemeral: (args: { channel: string; user: string; text: string; thread_ts?: string; blocks?: unknown[] }) =>
      slackCall("chat.postEphemeral", token, args),
  };
}
export type SlackClient = ReturnType<typeof slackClient>;

/** Slack's mrkdwn is not Markdown; convert the most common Claude output patterns. */
export function toMrkdwn(md: string): string {
  return md
    .replace(/\*\*(.+?)\*\*/g, "*$1*") // bold
    .replace(/^#{1,6}\s+(.+)$/gm, "*$1*") // headings
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, "<$2|$1>"); // links
}

/** Slack caps section text at 3000 chars and message text at ~40k; keep messages readable. */
export function truncate(s: string, max = 2900): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}
