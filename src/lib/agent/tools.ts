import type Anthropic from "@anthropic-ai/sdk";
import { db, type Job, type Team } from "../db";
import type { SlackClient } from "../slack/api";
import { parseSchedule, describeCron, ScheduleError } from "../schedule";
import { composioEnabled, composioUserId, createConnectLink, listConnectedApps } from "./composio";
import { isPublicHttpUrl, htmlToText } from "./web";
import { SLACK_HISTORY_LIMIT } from "../config";

export interface ToolEnv {
  team: Team;
  job: Job;
  slack: SlackClient;
  userTimezone: string;
}

/** Native tools: Slack, memory/playbooks, schedules, connections, web fetch. Kept short to save tokens. */
export const NATIVE_TOOLS: Anthropic.Tool[] = [
  {
    name: "slack_list_channels",
    description: "List public channels in the workspace (id, name, whether the bot is a member).",
    input_schema: { type: "object", properties: { query: { type: "string", description: "Optional name filter" } } },
  },
  {
    name: "slack_read_channel",
    description: "Read recent messages from a channel the bot is a member of.",
    input_schema: {
      type: "object",
      properties: {
        channel: { type: "string", description: "Channel id (C...)" },
        limit: { type: "integer", description: "Max messages (capped by Slack for non-Marketplace apps)" },
      },
      required: ["channel"],
    },
  },
  {
    name: "slack_read_thread",
    description: "Read all replies in a Slack thread.",
    input_schema: {
      type: "object",
      properties: { channel: { type: "string" }, thread_ts: { type: "string" } },
      required: ["channel", "thread_ts"],
    },
  },
  {
    name: "slack_find_messages",
    description: "Find recent messages containing a keyword in up to 3 channels the bot is a member of (recent messages only; Slack limits history reads).",
    input_schema: {
      type: "object",
      properties: { query: { type: "string" }, channels: { type: "array", items: { type: "string" }, description: "Optional channel ids" } },
      required: ["query"],
    },
  },
  {
    name: "slack_post_message",
    description: "Post a message to a Slack channel (by id). Your final answer is posted automatically; use this only to post somewhere else or on a schedule.",
    input_schema: {
      type: "object",
      properties: { channel: { type: "string" }, text: { type: "string" }, thread_ts: { type: "string" } },
      required: ["channel", "text"],
    },
  },
  {
    name: "web_fetch",
    description: "Fetch a public web page and return its text (truncated).",
    input_schema: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
  },
  {
    name: "remember_fact",
    description: "Save a short fact about the team for future tasks (e.g. 'Fiscal year starts in April').",
    input_schema: { type: "object", properties: { fact: { type: "string" } }, required: ["fact"] },
  },
  {
    name: "forget_fact",
    description: "Delete saved facts containing the given text.",
    input_schema: { type: "object", properties: { contains: { type: "string" } }, required: ["contains"] },
  },
  {
    name: "save_playbook",
    description: "Create or replace a named playbook: the step-by-step way this team does a process. Use when asked to 'remember how we do X' or given a process doc.",
    input_schema: {
      type: "object",
      properties: { name: { type: "string", description: "Short name, e.g. 'Weekly pipeline summary'" }, content: { type: "string", description: "Clear numbered steps, tools, channels, formats" } },
      required: ["name", "content"],
    },
  },
  {
    name: "list_playbooks",
    description: "List playbook names.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "get_playbook",
    description: "Read a playbook by name.",
    input_schema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
  },
  {
    name: "create_schedule",
    description: "Create a recurring task. Convert the user's wording to a 5-field cron in their timezone (e.g. every Monday 8am => '0 8 * * 1').",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        cron: { type: "string" },
        timezone: { type: "string", description: "IANA timezone; default the user's" },
        channel: { type: "string", description: "Channel id to deliver results to" },
        task: { type: "string", description: "Self-contained instruction to run each time" },
      },
      required: ["name", "cron", "channel", "task"],
    },
  },
  {
    name: "list_schedules",
    description: "List this team's schedules.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "delete_schedule",
    description: "Delete a schedule by id.",
    input_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  },
  {
    name: "connect_app",
    description: "Send the user a private link to connect one of their apps (e.g. 'hubspot', 'gmail', 'notion', 'linear', 'googlesheets').",
    input_schema: { type: "object", properties: { app: { type: "string" } }, required: ["app"] },
  },
  {
    name: "list_connections",
    description: "List apps the requesting user has connected.",
    input_schema: { type: "object", properties: {} },
  },
];

type Input = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));

interface SlackMsg { user?: string; bot_id?: string; text?: string; ts?: string; thread_ts?: string; reply_count?: number }

function formatMessages(msgs: SlackMsg[]): string {
  return msgs
    .map((m) => `[${m.ts}] ${m.user ? `<@${m.user}>` : m.bot_id ? "bot" : "?"}: ${(m.text || "").slice(0, 800)}${m.reply_count ? ` (${m.reply_count} replies)` : ""}`)
    .join("\n");
}

export async function runNativeTool(name: string, input: Input, env: ToolEnv): Promise<string> {
  const { team, job, slack } = env;
  switch (name) {
    case "slack_list_channels": {
      const res = await slack.call<{ ok: boolean; channels: Array<{ id: string; name: string; is_member: boolean }> }>(
        "conversations.list",
        { types: "public_channel", exclude_archived: true, limit: 500 },
      );
      const q = str(input.query).toLowerCase();
      return res.channels
        .filter((c) => !q || c.name.includes(q))
        .slice(0, 100)
        .map((c) => `${c.id} #${c.name}${c.is_member ? " (member)" : ""}`)
        .join("\n") || "No channels found.";
    }
    case "slack_read_channel": {
      const limit = Math.min(Number(input.limit) || SLACK_HISTORY_LIMIT, SLACK_HISTORY_LIMIT);
      try {
        const res = await slack.call<{ ok: boolean; messages: SlackMsg[] }>("conversations.history", { channel: str(input.channel), limit });
        return formatMessages(res.messages.reverse()) || "No messages.";
      } catch (e) {
        if (String(e).includes("not_in_channel")) return "I'm not a member of that channel. Ask someone to /invite me.";
        if (String(e).includes("rate_limited")) return "Slack is rate-limiting history reads right now (about 1 per minute for this app). Try again shortly or use what you already have.";
        throw e;
      }
    }
    case "slack_read_thread": {
      const res = await slack.call<{ ok: boolean; messages: SlackMsg[] }>("conversations.replies", {
        channel: str(input.channel), ts: str(input.thread_ts), limit: SLACK_HISTORY_LIMIT,
      }).catch((e) => {
        if (String(e).includes("rate_limited")) return { ok: true, messages: [{ text: "(Slack rate limit hit; try again in a minute)" }] as SlackMsg[] };
        throw e;
      });
      return formatMessages(res.messages);
    }
    case "slack_find_messages": {
      const q = str(input.query).toLowerCase();
      let channels = Array.isArray(input.channels) ? (input.channels as string[]) : [];
      if (channels.length === 0) {
        const res = await slack.call<{ ok: boolean; channels: Array<{ id: string }> }>("users.conversations", {
          types: "public_channel,private_channel", limit: 50,
        });
        channels = res.channels.map((c) => c.id);
      }
      const hits: string[] = [];
      for (const ch of channels.slice(0, 3)) {
        const res = await slack.call<{ ok: boolean; messages: SlackMsg[] }>("conversations.history", { channel: ch, limit: SLACK_HISTORY_LIMIT }).catch(() => null);
        for (const m of res?.messages ?? []) {
          if ((m.text || "").toLowerCase().includes(q)) hits.push(`<#${ch}> [${m.ts}] <@${m.user}>: ${(m.text || "").slice(0, 300)}`);
          if (hits.length >= 30) break;
        }
      }
      return hits.join("\n") || "No matching messages found.";
    }
    case "slack_post_message": {
      const res = await slack.postMessage({ channel: str(input.channel), text: str(input.text), thread_ts: str(input.thread_ts) || undefined });
      return `Posted (ts ${res.ts}).`;
    }
    case "web_fetch": {
      const url = str(input.url);
      if (!isPublicHttpUrl(url)) return "That URL is not allowed (must be a public http(s) address).";
      const res = await fetch(url, { headers: { "User-Agent": "TeammateBot/1.0" }, redirect: "follow", signal: AbortSignal.timeout(15000) });
      const type = res.headers.get("content-type") || "";
      const body = await res.text();
      const text = type.includes("html") ? htmlToText(body) : body;
      return `HTTP ${res.status}\n${text.slice(0, 8000)}`;
    }
    case "remember_fact": {
      await db().from("memories").insert({ team_id: team.id, fact: str(input.fact).slice(0, 500), created_by: job.slack_user_id });
      return "Saved.";
    }
    case "forget_fact": {
      const { data } = await db().from("memories").delete().eq("team_id", team.id).ilike("fact", `%${str(input.contains)}%`).select("id");
      return `Deleted ${data?.length ?? 0} fact(s).`;
    }
    case "save_playbook": {
      const { error } = await db().from("playbooks").upsert(
        { team_id: team.id, name: str(input.name).slice(0, 120), content: str(input.content).slice(0, 20000), created_by: job.slack_user_id, updated_at: new Date().toISOString() },
        { onConflict: "team_id,name" },
      );
      if (error) throw new Error(error.message);
      return `Playbook "${str(input.name)}" saved.`;
    }
    case "list_playbooks": {
      const { data } = await db().from("playbooks").select("name").eq("team_id", team.id).order("name");
      return (data ?? []).map((p) => `- ${p.name}`).join("\n") || "No playbooks yet.";
    }
    case "get_playbook": {
      const { data } = await db().from("playbooks").select("name, content").eq("team_id", team.id).ilike("name", str(input.name)).maybeSingle();
      return data ? `# ${data.name}\n${data.content}` : "No playbook with that name.";
    }
    case "create_schedule": {
      const tz = str(input.timezone) || env.userTimezone || team.timezone;
      try {
        const { next } = parseSchedule(str(input.cron), tz);
        const { data, error } = await db().from("schedules").insert({
          team_id: team.id, name: str(input.name).slice(0, 120), cron: str(input.cron).trim(), timezone: tz,
          channel_id: str(input.channel), prompt: str(input.task).slice(0, 4000), created_by: job.slack_user_id,
          next_run_at: next.toISOString(),
        }).select("id").single();
        if (error) throw new Error(error.message);
        return `Schedule created (id ${data.id}): ${describeCron(str(input.cron), tz)}, posting to <#${str(input.channel)}>. First run ${next.toISOString()}.`;
      } catch (e) {
        if (e instanceof ScheduleError) return `Could not create schedule: ${e.message}`;
        throw e;
      }
    }
    case "list_schedules": {
      const { data } = await db().from("schedules").select("id, name, cron, timezone, channel_id, enabled").eq("team_id", team.id);
      return (data ?? []).map((s) => `${s.id} | ${s.name} | ${describeCron(s.cron, s.timezone)} | <#${s.channel_id}>${s.enabled ? "" : " (paused)"}`).join("\n") || "No schedules.";
    }
    case "delete_schedule": {
      const { data } = await db().from("schedules").delete().eq("team_id", team.id).eq("id", str(input.id)).select("id");
      return data?.length ? "Schedule deleted." : "No schedule with that id.";
    }
    case "connect_app": {
      if (!composioEnabled()) return "App connections are not configured (COMPOSIO_API_KEY missing).";
      const app = str(input.app);
      const url = await createConnectLink(composioUserId(team.id, job.slack_user_id), app);
      await slack.postEphemeral({
        channel: job.channel_id,
        user: job.slack_user_id,
        thread_ts: job.thread_ts || undefined,
        text: `Connect ${app}: ${url}`,
        blocks: [
          { type: "section", text: { type: "mrkdwn", text: `Here's your private link to connect *${app}*. It uses your own account.` } },
          { type: "actions", elements: [{ type: "button", text: { type: "plain_text", text: `Connect ${app}` }, url, style: "primary" }] },
        ],
      }).catch(async () => {
        // Ephemeral fails in some contexts (e.g. scheduled runs). Fall back to a DM.
        const im = await slack.call<{ ok: boolean; channel: { id: string } }>("conversations.open", { users: job.slack_user_id });
        await slack.postMessage({ channel: im.channel.id, text: `Connect ${app}: ${url}` });
      });
      return `Sent the user a private connect link for ${app}. Ask them to tell you when it's done.`;
    }
    case "list_connections": {
      const apps = await listConnectedApps(composioUserId(team.id, job.slack_user_id));
      return apps.length ? apps.map((a) => `- ${a.name} (${a.slug})`).join("\n") : "No apps connected yet.";
    }
    default:
      throw new Error(`Unknown tool ${name}`);
  }
}

export const NATIVE_TOOL_NAMES = new Set(NATIVE_TOOLS.map((t) => t.name));
