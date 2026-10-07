import { waitUntil } from "@vercel/functions";
import { readVerifiedSlackBody } from "@/lib/slack/verify";
import { db, getBotToken, getTeam, isAdmin, isAllowed, type Team } from "@/lib/db";
import { slackCall } from "@/lib/slack/api";
import { connectLinkModal, connectModal, decidedBlocks, messageModal, teachModal, type GatedCall } from "@/lib/slack/blocks";
import { composioEnabled, composioUserId, createConnectLink } from "@/lib/agent/composio";
import { publishHome } from "@/lib/slack/home";
import { logToolCall } from "@/lib/audit";
import { drainQueue } from "@/lib/worker";
import { updateJob } from "@/lib/jobs";
import type { JobState } from "@/lib/agent/run";

export const maxDuration = 300;

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Buttons and modals: approvals, App Home onboarding, teach/connect modals. */
export async function POST(req: Request) {
  const raw = await readVerifiedSlackBody(req);
  if (raw === null) return new Response("invalid signature", { status: 401 });
  const payload = JSON.parse(new URLSearchParams(raw).get("payload") || "{}");
  const teamId: string = payload.team?.id || payload.user?.team_id;
  const userId: string = payload.user?.id;

  const team = await getTeam(teamId);
  const token = team && (await getBotToken(teamId));
  if (!team || !token) return new Response("ok");

  if (payload.type === "block_actions") {
    const action = payload.actions?.[0];
    switch (action?.action_id) {
      case "approve":
      case "reject":
        return handleDecision(team, token, userId, action.value, action.action_id === "approve" ? "approved" : "rejected", payload);
      case "home_connect":
        await slackCall("views.open", token, { trigger_id: payload.trigger_id, view: connectModal() });
        return new Response("ok");
      case "home_teach":
        await slackCall("views.open", token, { trigger_id: payload.trigger_id, view: teachModal() });
        return new Response("ok");
      default:
        return new Response("ok"); // link buttons etc.
    }
  }

  if (payload.type === "view_submission") {
    const values = payload.view?.state?.values ?? {};
    if (payload.view?.callback_id === "connect_modal") {
      const app = (values.other?.value?.value || values.app?.value?.selected_option?.value || "").trim();
      if (!app) return Response.json({ response_action: "errors", errors: { other: "Pick or type an app" } });
      if (!isAllowed(team, userId)) return Response.json({ response_action: "update", view: messageModal("Not allowed", "You're not on the allow-list. Ask an admin.") });
      if (!composioEnabled()) return Response.json({ response_action: "update", view: messageModal("Not configured", "App connections need COMPOSIO_API_KEY to be set.") });
      try {
        const url = await createConnectLink(composioUserId(team.id, userId), app);
        await logToolCall({ teamId: team.id, actor: userId, tool: "connect_app", kind: "internal", input: { app }, result: "link created", status: "ok" });
        return Response.json({ response_action: "update", view: connectLinkModal(app, url) });
      } catch (e) {
        return Response.json({ response_action: "update", view: messageModal("Couldn't connect", `I couldn't create a link for *${app}*: ${(e as Error).message}`) });
      }
    }
    if (payload.view?.callback_id === "teach_modal") {
      const name = String(values.name?.value?.value || "").trim().slice(0, 120);
      const content = String(values.content?.value?.value || "").trim();
      if (!isAllowed(team, userId)) return Response.json({ response_action: "errors", errors: { name: "You're not on the allow-list." } });
      const { error } = await db().from("playbooks").upsert(
        { team_id: team.id, name, content, created_by: userId, updated_at: new Date().toISOString() },
        { onConflict: "team_id,name" },
      );
      if (error) return Response.json({ response_action: "errors", errors: { name: error.message } });
      await logToolCall({ teamId: team.id, actor: userId, tool: "save_playbook", kind: "internal", input: { name }, result: "saved from App Home", status: "ok" });
      waitUntil(publishHome(team, token, userId).catch(() => {}));
      return Response.json({ response_action: "clear" });
    }
  }
  return new Response("ok");
}

async function handleDecision(team: Team, token: string, userId: string, approvalId: string, decision: "approved" | "rejected", payload: any) {
  const { data: approval } = await db().from("approvals").select("*").eq("id", approvalId).eq("team_id", team.id).maybeSingle();
  if (!approval) return new Response("ok");

  const ephemeral = (text: string) =>
    fetch(payload.response_url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ response_type: "ephemeral", replace_original: false, text }) });

  if (approval.requested_by !== userId && !isAdmin(team, userId)) {
    await ephemeral("Only the person who asked, or a workspace admin, can decide this.");
    return new Response("ok");
  }

  // Atomic: only the first click wins.
  const { data: updated } = await db()
    .from("approvals")
    .update({ status: decision, decided_by: userId, decided_at: new Date().toISOString() })
    .eq("id", approvalId)
    .eq("status", "pending")
    .select("id");
  if (!updated?.length) {
    await ephemeral(`This request was already ${approval.status}.`);
    return new Response("ok");
  }

  const calls = approval.tool_calls as GatedCall[];
  if (approval.message_ts && approval.channel_id) {
    await slackCall("chat.update", token, {
      channel: approval.channel_id,
      ts: approval.message_ts,
      text: decision === "approved" ? "Approved" : "Rejected",
      blocks: decidedBlocks(decision, userId, calls),
    }).catch(() => {});
  }
  for (const c of calls) {
    await logToolCall({ teamId: team.id, jobId: approval.job_id, actor: userId, tool: c.name, kind: c.kind, input: c.input, status: decision });
  }

  const { data: job } = await db().from("jobs").select("state").eq("id", approval.job_id).single();
  const state = (job?.state || {}) as JobState;
  state.decision = { approvalId, status: decision, by: userId };
  await updateJob(approval.job_id, { state: state as Record<string, unknown>, status: "queued", locked_until: null, attempts: 0 });

  waitUntil(drainQueue({ jobId: approval.job_id, maxMs: 280_000 }).catch((e) => console.error("resume failed", e)));
  return new Response("ok");
}
