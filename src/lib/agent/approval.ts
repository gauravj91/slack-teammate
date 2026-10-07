import type { Autonomy } from "../db";

/**
 * Approval gating. Every tool call is classified, then the team's autonomy setting
 * decides whether a human must approve it in Slack before it runs.
 *
 *  read           – looks things up, no side effects
 *  internal       – changes only the teammate's own memory/playbooks/schedules (user asked for it)
 *  write          – creates/updates/deletes data in a connected tool
 *  external_send  – sends something people will see (email, message to another channel, invite)
 */
export type ToolKind = "read" | "internal" | "write" | "external_send";

const SEVERITY: Record<ToolKind, number> = { read: 0, internal: 1, write: 2, external_send: 3 };

const SEND_VERBS = new Set([
  "SEND", "REPLY", "FORWARD", "POST", "PUBLISH", "INVITE", "SHARE", "TWEET", "NOTIFY", "BROADCAST",
  "MESSAGE", "EMAIL", "DM", "COMMENT", "SCHEDULE",
]);
const WRITE_VERBS = new Set([
  "CREATE", "UPDATE", "DELETE", "REMOVE", "ADD", "SET", "EDIT", "MODIFY", "PATCH", "PUT", "INSERT",
  "UPSERT", "MOVE", "ARCHIVE", "UNARCHIVE", "CLOSE", "REOPEN", "MERGE", "ASSIGN", "UNASSIGN", "UPLOAD",
  "WRITE", "CANCEL", "APPROVE", "REJECT", "RENAME", "TRASH", "STAR", "UNSTAR", "LABEL", "MARK", "ENABLE",
  "DISABLE", "REVOKE", "GRANT", "IMPORT", "DUPLICATE", "COPY", "CONVERT", "TRANSFER", "PAY", "REFUND",
  "CHARGE", "SUBMIT", "RUN", "EXECUTE", "TRIGGER", "START", "STOP", "PAUSE", "RESUME", "BATCH", "BULK",
  "APPEND", "REPLACE", "CLEAR", "RESET", "LOCK", "UNLOCK", "PIN", "UNPIN", "JOIN", "LEAVE", "KICK",
]);
const READ_VERBS = new Set([
  "GET", "LIST", "FETCH", "SEARCH", "FIND", "READ", "RETRIEVE", "QUERY", "DESCRIBE", "COUNT", "CHECK",
  "LOOKUP", "VIEW", "SHOW", "DOWNLOAD", "EXPORT", "PREVIEW", "VALIDATE", "VERIFY", "WHOAMI", "INFO",
]);

/** Classify a third-party tool slug such as GMAIL_SEND_EMAIL or HUBSPOT_LIST_DEALS. */
export function classifySlug(slug: string): ToolKind {
  const parts = slug.toUpperCase().split(/[_\s-]+/).filter(Boolean);
  // parts[0] is the toolkit (GMAIL, HUBSPOT...). Look at the verbs that follow, first match wins.
  for (const p of parts.slice(1)) {
    if (READ_VERBS.has(p)) return "read";
    if (SEND_VERBS.has(p)) return "external_send";
    if (WRITE_VERBS.has(p)) return "write";
  }
  return "write"; // unknown: be conservative
}

const NATIVE_KINDS: Record<string, ToolKind> = {
  slack_list_channels: "read",
  slack_read_channel: "read",
  slack_read_thread: "read",
  slack_find_messages: "read",
  web_fetch: "read",
  list_playbooks: "read",
  get_playbook: "read",
  list_schedules: "read",
  list_connections: "read",
  remember_fact: "internal",
  forget_fact: "internal",
  save_playbook: "internal",
  create_schedule: "internal",
  delete_schedule: "internal",
  connect_app: "internal",
  // slack_post_message is decided per call (see classifyToolCall)
};

const COMPOSIO_SAFE_META = new Set([
  "COMPOSIO_SEARCH_TOOLS",
  "COMPOSIO_GET_TOOL_SCHEMAS",
  "COMPOSIO_MANAGE_CONNECTIONS",
  "COMPOSIO_WAIT_FOR_CONNECTIONS",
  "COMPOSIO_LIST_TOOLKITS",
]);

export interface CallContext {
  /** Channel the task is running in; posting back there is the normal reply, not an external send. */
  currentChannel: string;
}

export function maxKind(kinds: ToolKind[]): ToolKind {
  return kinds.reduce<ToolKind>((acc, k) => (SEVERITY[k] > SEVERITY[acc] ? k : acc), "read");
}

/** Classify one tool call (native, Composio meta tool, or direct app tool). */
export function classifyToolCall(name: string, input: unknown, ctx: CallContext): ToolKind {
  if (name === "slack_post_message") {
    const ch = (input as { channel?: string } | null)?.channel;
    return ch && ch !== ctx.currentChannel ? "external_send" : "write";
  }
  if (NATIVE_KINDS[name]) return NATIVE_KINDS[name];

  if (name === "COMPOSIO_MULTI_EXECUTE_TOOL") {
    const tools = (input as { tools?: Array<{ tool_slug?: string }> } | null)?.tools;
    if (!Array.isArray(tools) || tools.length === 0) return "write";
    return maxKind(tools.map((t) => classifySlug(String(t?.tool_slug ?? ""))));
  }
  if (COMPOSIO_SAFE_META.has(name)) return "read";
  if (name.startsWith("COMPOSIO_")) return "write"; // workbench/bash etc. can do anything
  return classifySlug(name);
}

/** Does this kind of call need a human click under the given autonomy mode? */
export function needsApproval(kind: ToolKind, autonomy: Autonomy): boolean {
  switch (autonomy) {
    case "full_auto":
      return false;
    case "ask_external":
      return kind === "external_send";
    case "ask_writes":
    default:
      return kind === "write" || kind === "external_send";
  }
}

export const AUTONOMY_LABELS: Record<Autonomy, string> = {
  ask_writes: "Ask before any change (safest)",
  ask_external: "Ask only before sending things to people",
  full_auto: "Full auto (never ask)",
};
