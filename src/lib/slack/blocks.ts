import { PRODUCT_NAME, appUrl } from "../config";
import { AUTONOMY_LABELS, type ToolKind } from "../agent/approval";
import type { Team } from "../db";
import { truncate } from "./api";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Block = Record<string, any>;

export function statusBlocks(title: string, progress: string[]): Block[] {
  const lines = progress.slice(-8).map((p) => `• ${p}`).join("\n");
  return [
    { type: "context", elements: [{ type: "mrkdwn", text: `:hourglass_flowing_sand: *${title}*` }] },
    ...(lines ? [{ type: "section", text: { type: "mrkdwn", text: truncate(lines, 2900) } }] : []),
  ];
}

export function resultBlocks(text: string, progress: string[], footer?: string): Block[] {
  const blocks: Block[] = [];
  // Slack sections hold max 3000 chars; split long answers.
  for (let i = 0; i < text.length && blocks.length < 45; i += 2900) {
    blocks.push({ type: "section", text: { type: "mrkdwn", text: text.slice(i, i + 2900) } });
  }
  const meta = [progress.length ? `${progress.length} step${progress.length === 1 ? "" : "s"}` : null, footer].filter(Boolean).join(" · ");
  if (meta) blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: meta }] });
  return blocks;
}

export interface GatedCall {
  id: string;
  name: string;
  input: unknown;
  kind: ToolKind;
}

function describeCall(c: GatedCall): string {
  if (c.name === "COMPOSIO_MULTI_EXECUTE_TOOL") {
    const tools = ((c.input as any)?.tools ?? []) as Array<{ tool_slug?: string; arguments?: unknown }>;
    return tools.map((t) => `*${t.tool_slug}*\n\`\`\`${truncate(JSON.stringify(t.arguments ?? {}, null, 1), 700)}\`\`\``).join("\n");
  }
  return `*${c.name}*\n\`\`\`${truncate(JSON.stringify(c.input ?? {}, null, 1), 900)}\`\`\``;
}

export function approvalBlocks(approvalId: string, requester: string, calls: GatedCall[]): Block[] {
  const label = calls.some((c) => c.kind === "external_send") ? "send something on your behalf" : "make a change";
  return [
    { type: "section", text: { type: "mrkdwn", text: `:raised_hand: <@${requester}>, I'd like to ${label}. Approve?` } },
    ...calls.map((c) => ({ type: "section", text: { type: "mrkdwn", text: truncate(describeCall(c), 2900) } })),
    {
      type: "actions",
      block_id: "approval",
      elements: [
        { type: "button", action_id: "approve", text: { type: "plain_text", text: "Approve" }, style: "primary", value: approvalId },
        { type: "button", action_id: "reject", text: { type: "plain_text", text: "Reject" }, style: "danger", value: approvalId },
      ],
    },
    { type: "context", elements: [{ type: "mrkdwn", text: "The requester or a workspace admin can decide. Change this in Settings → Autonomy." }] },
  ];
}

export function decidedBlocks(decision: "approved" | "rejected", by: string, calls: GatedCall[]): Block[] {
  const names = calls
    .flatMap((c) => (c.name === "COMPOSIO_MULTI_EXECUTE_TOOL" ? (((c.input as any)?.tools ?? []) as any[]).map((t) => t.tool_slug) : [c.name]))
    .join(", ");
  return [
    {
      type: "context",
      elements: [{ type: "mrkdwn", text: `${decision === "approved" ? ":white_check_mark: Approved" : ":no_entry_sign: Rejected"} by <@${by}> · ${names}` }],
    },
  ];
}

export function homeView(team: Team, stats: { apps: number; playbooks: number; schedules: number; isAdmin: boolean }): Block {
  const done = (b: boolean) => (b ? ":white_check_mark:" : ":white_circle:");
  return {
    type: "home",
    blocks: [
      { type: "header", text: { type: "plain_text", text: `Welcome to ${PRODUCT_NAME}` } },
      { type: "section", text: { type: "mrkdwn", text: `I'm your AI teammate. I don't just chat, I do the work: I use your tools, follow your team's playbooks, run tasks on request or on a schedule, and ask before I change anything.` } },
      { type: "divider" },
      {
        type: "section",
        text: { type: "mrkdwn", text: `${done(stats.apps > 0)} *1. Connect your tools*\nHubSpot, Gmail, Notion, Linear, Google Sheets and hundreds more. Each person connects their own account.${stats.apps ? `\n_${stats.apps} connected for you._` : ""}` },
        accessory: { type: "button", action_id: "home_connect", text: { type: "plain_text", text: "Connect an app" }, style: "primary" },
      },
      {
        type: "section",
        text: { type: "mrkdwn", text: `${done(stats.playbooks > 0)} *2. Teach me how you work*\nAdd a playbook (a named process) or just tell me in chat: _"remember how we do weekly reporting: …"_${stats.playbooks ? `\n_${stats.playbooks} playbook(s) saved._` : ""}` },
        accessory: { type: "button", action_id: "home_teach", text: { type: "plain_text", text: "Add a playbook" } },
      },
      {
        type: "section",
        text: { type: "mrkdwn", text: `${done(stats.schedules > 0)} *3. Hand off a task*\nMention me in any channel (invite me first with \`/invite @${PRODUCT_NAME}\`) or DM me. Try:\n• _"Summarise this week's open deals in HubSpot"_\n• _"Every Monday 8am post the pipeline summary to #sales"_\n• _"Draft a reply to the latest email from Acme"_` },
      },
      { type: "divider" },
      {
        type: "context",
        elements: [{ type: "mrkdwn", text: `Autonomy: *${AUTONOMY_LABELS[team.autonomy]}*${stats.isAdmin ? " · you're an admin" : ""}` }],
      },
      {
        type: "actions",
        elements: [{ type: "button", action_id: "home_dashboard", text: { type: "plain_text", text: "Open dashboard" }, url: `${appUrl()}/dashboard` }],
      },
    ],
  };
}

export function connectModal(): Block {
  return {
    type: "modal",
    callback_id: "connect_modal",
    title: { type: "plain_text", text: "Connect an app" },
    submit: { type: "plain_text", text: "Get link" },
    close: { type: "plain_text", text: "Cancel" },
    blocks: [
      {
        type: "input",
        block_id: "app",
        label: { type: "plain_text", text: "Which app?" },
        element: {
          type: "static_select",
          action_id: "value",
          placeholder: { type: "plain_text", text: "Pick an app" },
          options: ["hubspot", "gmail", "googlecalendar", "googlesheets", "googledrive", "notion", "linear", "jira", "github", "salesforce", "asana", "trello", "airtable", "zendesk", "intercom", "stripe"].map((a) => ({
            text: { type: "plain_text", text: a },
            value: a,
          })),
        },
        optional: true,
      },
      {
        type: "input",
        block_id: "other",
        label: { type: "plain_text", text: "…or type any other app" },
        element: { type: "plain_text_input", action_id: "value", placeholder: { type: "plain_text", text: "e.g. pipedrive" } },
        optional: true,
      },
    ],
  };
}

export function connectLinkModal(app: string, url: string): Block {
  return {
    type: "modal",
    title: { type: "plain_text", text: "Connect an app" },
    close: { type: "plain_text", text: "Done" },
    blocks: [
      { type: "section", text: { type: "mrkdwn", text: `Click below to sign in to *${app}* with your own account. Come back here when you're done.` } },
      { type: "actions", elements: [{ type: "button", text: { type: "plain_text", text: `Connect ${app}` }, url, style: "primary" }] },
    ],
  };
}

export function messageModal(title: string, text: string): Block {
  return {
    type: "modal",
    title: { type: "plain_text", text: title.slice(0, 24) },
    close: { type: "plain_text", text: "Close" },
    blocks: [{ type: "section", text: { type: "mrkdwn", text } }],
  };
}

export function teachModal(): Block {
  return {
    type: "modal",
    callback_id: "teach_modal",
    title: { type: "plain_text", text: "Add a playbook" },
    submit: { type: "plain_text", text: "Save" },
    close: { type: "plain_text", text: "Cancel" },
    blocks: [
      {
        type: "input",
        block_id: "name",
        label: { type: "plain_text", text: "Name" },
        element: { type: "plain_text_input", action_id: "value", placeholder: { type: "plain_text", text: "Weekly pipeline summary" } },
      },
      {
        type: "input",
        block_id: "content",
        label: { type: "plain_text", text: "How do we do it? (paste a doc or write the steps)" },
        element: { type: "plain_text_input", action_id: "value", multiline: true, max_length: 3000 },
      },
    ],
  };
}
