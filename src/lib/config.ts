/**
 * Central configuration. Rename the product by setting NEXT_PUBLIC_PRODUCT_NAME.
 */
export const PRODUCT_NAME = process.env.NEXT_PUBLIC_PRODUCT_NAME || "Teammate";

export const DEFAULT_MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";
export const DEFAULT_EFFORT = (process.env.ANTHROPIC_EFFORT || "low") as "low" | "medium" | "high";

/** Models offered in the dashboard. Keep in sync with https://platform.claude.com/docs/en/models/overview */
export const MODEL_CHOICES = [
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5 (balanced, default)" },
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5 (cheapest, retiring soon)" },
  { id: "claude-opus-5-5", label: "Claude Opus 5.5 (most capable, pricier)" },
];

/** Seconds a single worker invocation may spend on one job before handing it back to the queue.
 *  Vercel Hobby functions stop at 300s; leave headroom. */
export const WORKER_TIME_BUDGET_MS = Number(process.env.WORKER_TIME_BUDGET_MS || 240_000);

/**
 * Slack limits conversations.history / conversations.replies for apps distributed outside the
 * Slack Marketplace to 1 request/minute and 15 messages (docs.slack.dev changelog 2025-05-29).
 * Internal (single-workspace) and Marketplace-approved apps get 50+/min and 1000 messages:
 * raise SLACK_HISTORY_LIMIT to 100 in that case.
 */
export const SLACK_HISTORY_LIMIT = Number(process.env.SLACK_HISTORY_LIMIT || 15);

/** Minimum minutes between runs of a schedule (protects free tiers from runaway crons). */
export const MIN_SCHEDULE_INTERVAL_MINUTES = Number(process.env.MIN_SCHEDULE_INTERVAL_MINUTES || 15);

export function appUrl(): string {
  const url =
    process.env.NEXT_PUBLIC_APP_URL ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "") ||
    "http://localhost:3000";
  return url.replace(/\/$/, "");
}

export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable ${name}. See .env.example.`);
  return v;
}

/** Bot scopes requested at install. Keep in sync with slack/manifest.yml. */
export const SLACK_BOT_SCOPES = [
  "app_mentions:read",
  "channels:history",
  "channels:read",
  "chat:write",
  "chat:write.public",
  "files:read",
  "groups:history",
  "groups:read",
  "im:history",
  "im:read",
  "im:write",
  "users:read",
  "users:read.email",
];
