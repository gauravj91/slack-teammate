import Anthropic from "@anthropic-ai/sdk";
import { db, getBotToken, getTeam, type Job, type Team } from "../db";
import { DEFAULT_EFFORT, DEFAULT_MODEL, SLACK_HISTORY_LIMIT, WORKER_TIME_BUDGET_MS } from "../config";
import { slackClient, toMrkdwn, type SlackClient } from "../slack/api";
import { approvalBlocks, resultBlocks, statusBlocks, type GatedCall } from "../slack/blocks";
import { logToolCall, summarize } from "../audit";
import { kickWorker, updateJob } from "../jobs";
import { classifyToolCall, needsApproval } from "./approval";
import { loadTeamContext } from "./context";
import { STATIC_SYSTEM, dynamicSystem } from "./prompt";
import { NATIVE_TOOLS, NATIVE_TOOL_NAMES, runNativeTool, type ToolEnv } from "./tools";
import {
  composioEnabled,
  composioUserId,
  executeComposioTool,
  getComposioTools,
  getSession,
  listConnectedApps,
} from "./composio";

type MessageParam = Anthropic.MessageParam;
type ContentBlock = Anthropic.ContentBlock;

/** Everything we need to resume a task in a later function invocation. */
export interface JobState {
  messages?: MessageParam[];
  progress?: string[];
  composioSessionId?: string;
  userTimezone?: string;
  eventTs?: string;
  inThread?: boolean;
  files?: Array<{ name?: string; mimetype?: string; url?: string }>;
  pending?: {
    approvalId: string;
    toolUses: Array<{ id: string; name: string; input: unknown }>;
    results: Record<string, string>;
    gated: GatedCall[];
  };
  decision?: { approvalId: string; status: "approved" | "rejected"; by: string };
}

const MAX_TOOL_RESULT_CHARS = 12_000;
const STEP_LABELS: Record<string, string> = {
  COMPOSIO_SEARCH_TOOLS: "Looking for the right tool",
  COMPOSIO_GET_TOOL_SCHEMAS: "Reading tool details",
  slack_read_channel: "Reading channel history",
  slack_read_thread: "Reading the thread",
  slack_find_messages: "Searching Slack",
  web_fetch: "Reading a web page",
  save_playbook: "Saving playbook",
  remember_fact: "Saving to memory",
  create_schedule: "Creating schedule",
  connect_app: "Sending you a connect link",
};

function stepLabel(name: string, input: unknown): string {
  if (name === "COMPOSIO_MULTI_EXECUTE_TOOL") {
    const slugs = ((input as { tools?: Array<{ tool_slug?: string }> })?.tools ?? []).map((t) => t.tool_slug).filter(Boolean);
    return `Running ${slugs.join(", ") || "app tools"}`;
  }
  return STEP_LABELS[name] ?? `Running ${name}`;
}

/** Mark only the last block of the last message for caching (max 4 cache breakpoints per request). */
function withCacheBreakpoint(messages: MessageParam[]): MessageParam[] {
  const copy = structuredClone(messages);
  const last = copy[copy.length - 1];
  if (!last) return copy;
  if (typeof last.content === "string") {
    last.content = [{ type: "text", text: last.content, cache_control: { type: "ephemeral" } }];
  } else if (last.content.length) {
    const block = last.content[last.content.length - 1] as { cache_control?: unknown };
    block.cache_control = { type: "ephemeral" };
  }
  return copy;
}

async function userTimezone(slack: SlackClient, userId: string, fallback: string): Promise<string> {
  try {
    const res = await slack.call<{ ok: boolean; user: { tz?: string } }>("users.info", { user: userId });
    return res.user.tz || fallback;
  } catch {
    return fallback;
  }
}

const TEXT_TYPES = /^(text\/|application\/(json|xml|csv|x-yaml|markdown))/;

/** Download text-like files attached to the request (used for "learn this doc as a playbook"). */
async function readAttachments(state: JobState, token: string): Promise<string> {
  const parts: string[] = [];
  for (const f of state.files ?? []) {
    if (!f.url) continue;
    if (!TEXT_TYPES.test(f.mimetype || "") && !/\.(md|txt|csv|json)$/i.test(f.name || "")) {
      parts.push(`[Attachment ${f.name}: ${f.mimetype} is not a text file, so I can't read it. Ask for a .txt/.md copy or pasted text.]`);
      continue;
    }
    try {
      const res = await fetch(f.url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10000) });
      parts.push(`Attachment "${f.name}":\n${(await res.text()).slice(0, 15000)}`);
    } catch {
      parts.push(`[Could not download ${f.name}]`);
    }
  }
  return parts.join("\n\n");
}

async function initialMessage(job: Job, state: JobState, slack: SlackClient, botUserId: string, token: string): Promise<MessageParam> {
  let context = "";
  if (state.inThread && job.thread_ts) {
    try {
      const res = await slack.call<{ ok: boolean; messages: Array<{ user?: string; text?: string; ts: string; bot_id?: string }> }>(
        "conversations.replies",
        { channel: job.channel_id, ts: job.thread_ts, limit: SLACK_HISTORY_LIMIT },
      );
      const earlier = res.messages.filter((m) => m.ts !== state.eventTs).slice(-15);
      if (earlier.length) {
        context =
          "Earlier messages in this thread:\n" +
          earlier.map((m) => `${m.user === botUserId || m.bot_id ? "you" : `<@${m.user}>`}: ${(m.text || "").slice(0, 600)}`).join("\n") +
          "\n\n";
      }
    } catch {
      // not fatal
    }
  }
  const attachments = await readAttachments(state, token);
  return {
    role: "user",
    content: `${context}Request from <@${job.slack_user_id}>:\n${job.prompt}${attachments ? `\n\n${attachments}` : ""}`,
  };
}

/**
 * Run (or resume) one job until it finishes, needs approval, hits its budget, or runs out of time.
 * The job must already be claimed (status = running).
 */
export async function processJob(job: Job): Promise<void> {
  const started = Date.now();
  const team = await getTeam(job.team_id);
  const token = team ? await getBotToken(team.id) : null;
  if (!team || !token) {
    await updateJob(job.id, { status: "failed", error: "Workspace not installed" });
    return;
  }
  const slack = slackClient(token);
  const state = (job.state || {}) as JobState;
  state.progress ??= [];

  const statusThread = job.thread_ts || undefined;
  let statusTs = job.status_ts;

  const setStatus = async (title: string) => {
    try {
      if (!statusTs) {
        const res = await slack.postMessage({ channel: job.channel_id, thread_ts: statusThread, text: title, blocks: statusBlocks(title, state.progress!) });
        statusTs = res.ts;
        await updateJob(job.id, { status_ts: statusTs });
      } else {
        await slack.update({ channel: job.channel_id, ts: statusTs, text: title, blocks: statusBlocks(title, state.progress!) });
      }
    } catch (e) {
      console.error("status update failed", e);
    }
  };

  const finish = async (text: string, status: "done" | "failed" = "done") => {
    const body = toMrkdwn(text || "Done.");
    const footer = `${job.input_tokens + job.output_tokens} tokens`;
    try {
      if (statusTs) await slack.update({ channel: job.channel_id, ts: statusTs, text: body.slice(0, 3000), blocks: resultBlocks(body, state.progress!, footer) });
      else await slack.postMessage({ channel: job.channel_id, thread_ts: statusThread, text: body.slice(0, 3000), blocks: resultBlocks(body, state.progress!, footer) });
    } catch (e) {
      console.error("final post failed", e);
    }
    await updateJob(job.id, { status, result: text.slice(0, 20000), state: state as Record<string, unknown> });
    await db().rpc("add_team_tokens", { p_team_id: team.id, p_tokens: job.input_tokens + job.output_tokens });
  };

  try {
    await setStatus(state.pending ? "Resuming…" : "Working on it…");

    if (!state.userTimezone) state.userTimezone = await userTimezone(slack, job.slack_user_id, team.timezone);
    const env: ToolEnv = { team, job, slack, userTimezone: state.userTimezone };

    // Tools: native + Composio meta tools for this user.
    const cUserId = composioUserId(team.id, job.slack_user_id);
    let session: Awaited<ReturnType<typeof getSession>> | null = null;
    let tools: Anthropic.Tool[] = [...NATIVE_TOOLS];
    let connectedApps: string[] = [];
    if (composioEnabled()) {
      try {
        session = await getSession(cUserId, state.composioSessionId);
        state.composioSessionId = session.sessionId;
        tools = tools.concat(await getComposioTools(session));
        connectedApps = (await listConnectedApps(cUserId)).map((a) => a.slug);
      } catch (e) {
        console.error("Composio unavailable", e);
      }
    }
    tools = tools.map((t, i) => (i === tools.length - 1 ? { ...t, cache_control: { type: "ephemeral" as const } } : t));

    const runTool = async (tu: { id: string; name: string; input: unknown }): Promise<string> => {
      const t0 = Date.now();
      const kind = classifyToolCall(tu.name, tu.input, { currentChannel: job.channel_id });
      try {
        let out: string;
        if (NATIVE_TOOL_NAMES.has(tu.name)) out = await runNativeTool(tu.name, (tu.input ?? {}) as Record<string, unknown>, env);
        else if (session) out = await executeComposioTool(session, { type: "tool_use", id: tu.id, name: tu.name, input: tu.input } as Anthropic.ToolUseBlock);
        else out = "That tool is not available (app integrations are not configured).";
        await logToolCall({ teamId: team.id, jobId: job.id, actor: job.slack_user_id, tool: tu.name, kind, input: tu.input, result: out, status: "ok", durationMs: Date.now() - t0 });
        return out.length > MAX_TOOL_RESULT_CHARS ? out.slice(0, MAX_TOOL_RESULT_CHARS) + "\n…(truncated)" : out;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await logToolCall({ teamId: team.id, jobId: job.id, actor: job.slack_user_id, tool: tu.name, kind, input: tu.input, result: msg, status: "error", durationMs: Date.now() - t0 });
        return `Error: ${msg}`;
      }
    };

    // First run: build the conversation.
    if (!state.messages?.length) {
      state.messages = [await initialMessage(job, state, slack, team.bot_user_id, token)];
    }

    // Resuming after an approval decision.
    if (state.pending) {
      const { pending } = state;
      const decision = state.decision;
      if (!decision || decision.approvalId !== pending.approvalId) {
        await updateJob(job.id, { status: "awaiting_approval" });
        return;
      }
      for (const g of pending.gated) {
        if (decision.status === "approved") {
          state.progress.push(stepLabel(g.name, g.input));
          pending.results[g.id] = await runTool(g);
        } else {
          pending.results[g.id] = `The user (<@${decision.by}>) rejected this action. Do not retry it.`;
          await logToolCall({ teamId: team.id, jobId: job.id, actor: job.slack_user_id, tool: g.name, kind: g.kind, input: g.input, status: "rejected" });
        }
      }
      state.messages.push({
        role: "user",
        content: pending.toolUses.map((tu) => ({ type: "tool_result" as const, tool_use_id: tu.id, content: pending.results[tu.id] ?? "No result." })),
      });
      delete state.pending;
      delete state.decision;
    }

    const anthropic = new Anthropic();
    const model = team.model || DEFAULT_MODEL;
    const system: Anthropic.TextBlockParam[] = [
      { type: "text", text: STATIC_SYSTEM, cache_control: { type: "ephemeral" } },
      {
        type: "text",
        text: dynamicSystem({
          team,
          userId: job.slack_user_id,
          channelId: job.channel_id,
          timezone: state.userTimezone,
          context: await loadTeamContext(team.id, job.prompt),
          connectedApps,
          scheduled: job.source === "schedule",
        }),
      },
    ];

    let steps = job.steps;
    let inputTokens = job.input_tokens;
    let outputTokens = job.output_tokens;

    const callModel = async (opts: { noTools?: boolean } = {}) => {
      const res = await anthropic.messages.create({
        model,
        max_tokens: 4096,
        system,
        tools,
        ...(opts.noTools ? { tool_choice: { type: "none" as const } } : {}),
        messages: withCacheBreakpoint(state.messages!),
        // Effort trades thoroughness for tokens; Haiku does not support it.
        ...(model.includes("haiku") ? {} : { output_config: { effort: DEFAULT_EFFORT } }),
      });
      steps++;
      const u = res.usage;
      inputTokens += (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + Math.round((u.cache_read_input_tokens || 0) * 0.1);
      outputTokens += u.output_tokens || 0;
      job.input_tokens = inputTokens;
      job.output_tokens = outputTokens;
      return res;
    };

    const textOf = (content: ContentBlock[]) =>
      content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("\n").trim();

    while (true) {
      const overBudget = steps >= team.max_steps || inputTokens + outputTokens >= team.max_tokens;
      if (overBudget) {
        const last = state.messages[state.messages.length - 1];
        const note = { type: "text" as const, text: "Task budget reached. Stop using tools and give your best final answer now, saying what is left undone." };
        if (last.role === "user" && Array.isArray(last.content)) last.content.push(note);
        else state.messages.push({ role: "user", content: [note] });
        const res = await callModel({ noTools: true });
        await updateJob(job.id, { steps, input_tokens: inputTokens, output_tokens: outputTokens });
        await finish(textOf(res.content) + `\n\n_Stopped at the task limit (${team.max_steps} steps / ${team.max_tokens} tokens)._`);
        return;
      }

      if (Date.now() - started > WORKER_TIME_BUDGET_MS) {
        // Hand back to the queue; another invocation continues (survives the 300s Hobby limit).
        state.progress.push("Continuing in the background…");
        await updateJob(job.id, { status: "queued", locked_until: null, attempts: 0, state: state as Record<string, unknown>, steps, input_tokens: inputTokens, output_tokens: outputTokens });
        await setStatus("Still working…");
        await kickWorker(job.id);
        return;
      }

      const res = await callModel();
      state.messages.push({ role: "assistant", content: res.content as Anthropic.ContentBlockParam[] });

      const toolUses = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
      if (res.stop_reason !== "tool_use" || toolUses.length === 0) {
        await updateJob(job.id, { steps, input_tokens: inputTokens, output_tokens: outputTokens });
        await finish(textOf(res.content));
        return;
      }

      // Execute what's allowed now; collect what needs a human.
      const results: Record<string, string> = {};
      const gated: GatedCall[] = [];
      for (const tu of toolUses) {
        const kind = classifyToolCall(tu.name, tu.input, { currentChannel: job.channel_id });
        if (needsApproval(kind, team.autonomy)) {
          gated.push({ id: tu.id, name: tu.name, input: tu.input, kind });
          continue;
        }
        state.progress.push(stepLabel(tu.name, tu.input));
        await setStatus("Working on it…");
        results[tu.id] = await runTool(tu);
      }

      if (gated.length) {
        await requestApproval({ team, job, slack, state, toolUses, results, gated, statusThread });
        state.progress.push("Waiting for approval");
        await updateJob(job.id, {
          status: "awaiting_approval",
          state: state as Record<string, unknown>,
          steps,
          input_tokens: inputTokens,
          output_tokens: outputTokens,
        });
        await setStatus("Waiting for approval");
        return;
      }

      state.messages.push({
        role: "user",
        content: toolUses.map((tu) => ({ type: "tool_result" as const, tool_use_id: tu.id, content: results[tu.id] ?? "No result." })),
      });
      await updateJob(job.id, { state: state as Record<string, unknown>, steps, input_tokens: inputTokens, output_tokens: outputTokens });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("job failed", job.id, msg);
    await finish(`Sorry, something went wrong: ${summarize(msg, 300)}`, "failed");
    await updateJob(job.id, { error: msg.slice(0, 2000) });
  }
}

async function requestApproval(opts: {
  team: Team;
  job: Job;
  slack: SlackClient;
  state: JobState;
  toolUses: Anthropic.ToolUseBlock[];
  results: Record<string, string>;
  gated: GatedCall[];
  statusThread?: string;
}) {
  const { team, job, slack, state, gated } = opts;
  const { data, error } = await db()
    .from("approvals")
    .insert({ team_id: team.id, job_id: job.id, tool_calls: gated, requested_by: job.slack_user_id, channel_id: job.channel_id })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  const approvalId = data.id as string;

  const msg = await slack.postMessage({
    channel: job.channel_id,
    thread_ts: opts.statusThread,
    text: "Approval needed",
    blocks: approvalBlocks(approvalId, job.slack_user_id, gated),
  });
  await db().from("approvals").update({ message_ts: msg.ts }).eq("id", approvalId);

  for (const g of gated) {
    await logToolCall({ teamId: team.id, jobId: job.id, actor: job.slack_user_id, tool: g.name, kind: g.kind, input: g.input, status: "awaiting_approval" });
  }
  state.pending = {
    approvalId,
    toolUses: opts.toolUses.map((t) => ({ id: t.id, name: t.name, input: t.input })),
    results: opts.results,
    gated,
  };
}
