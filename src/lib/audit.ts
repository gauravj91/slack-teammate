import { db } from "./db";
import type { ToolKind } from "./agent/approval";

const SECRET_KEYS = /(token|secret|password|passwd|api[_-]?key|authorization|cookie|credential)/i;

/** Compact, redacted one-line summary of tool inputs/outputs for the audit trail. */
export function summarize(value: unknown, max = 400): string {
  const redact = (v: unknown, depth: number): unknown => {
    if (depth > 4) return "…";
    if (Array.isArray(v)) return v.slice(0, 10).map((x) => redact(x, depth + 1));
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        out[k] = SECRET_KEYS.test(k) ? "[redacted]" : redact(val, depth + 1);
      }
      return out;
    }
    if (typeof v === "string" && v.length > 200) return v.slice(0, 200) + "…";
    return v;
  };
  let s: string;
  try {
    s = typeof value === "string" ? value : JSON.stringify(redact(value, 0));
  } catch {
    s = String(value);
  }
  s = s.replace(/\s+/g, " ").trim();
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

export async function logToolCall(entry: {
  teamId: string;
  jobId?: string | null;
  actor?: string | null;
  tool: string;
  kind?: ToolKind;
  input?: unknown;
  result?: unknown;
  status: "ok" | "error" | "awaiting_approval" | "approved" | "rejected" | "blocked";
  durationMs?: number;
}) {
  const { error } = await db()
    .from("audit_log")
    .insert({
      team_id: entry.teamId,
      job_id: entry.jobId ?? null,
      actor: entry.actor ?? null,
      tool: entry.tool,
      kind: entry.kind ?? null,
      input_summary: entry.input === undefined ? null : summarize(entry.input),
      result_summary: entry.result === undefined ? null : summarize(entry.result),
      status: entry.status,
      duration_ms: entry.durationMs ?? null,
    });
  if (error) console.error("audit insert failed", error.message);
}
