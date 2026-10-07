"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireMember } from "@/lib/auth";
import { composioEnabled, composioUserId, createConnectLink, deleteConnectionsForUsers } from "@/lib/agent/composio";
import { parseSchedule, ScheduleError } from "@/lib/schedule";
import { db, getBotToken, type Autonomy } from "@/lib/db";
import { slackCall } from "@/lib/slack/api";
import { logToolCall } from "@/lib/audit";

const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

export async function connectApp(form: FormData) {
  const { member, team } = await requireMember();
  const app = s(form, "other") || s(form, "app");
  if (!app || !composioEnabled()) redirect("/dashboard/connections?error=1");
  const url = await createConnectLink(composioUserId(team.id, member.slack_user_id), app);
  await logToolCall({ teamId: team.id, actor: member.slack_user_id, tool: "connect_app", kind: "internal", input: { app, via: "dashboard" }, result: "link created", status: "ok" });
  redirect(url);
}

export async function savePlaybook(form: FormData) {
  const { supabase, member, team } = await requireMember();
  const name = s(form, "name").slice(0, 120);
  let content = s(form, "content");
  const file = form.get("file");
  if (file instanceof File && file.size > 0) {
    if (file.size > 500_000) redirect("/dashboard/playbooks?error=file_too_large");
    content = [content, await file.text()].filter(Boolean).join("\n\n");
  }
  if (!name || !content) redirect("/dashboard/playbooks?error=missing");
  const id = s(form, "id");
  const row = { team_id: team.id, name, content: content.slice(0, 20000), created_by: `dashboard:${member.email ?? member.slack_user_id}`, updated_at: new Date().toISOString() };
  const { error } = id
    ? await supabase.from("playbooks").update(row).eq("id", id)
    : await supabase.from("playbooks").upsert(row, { onConflict: "team_id,name" });
  if (error) redirect(`/dashboard/playbooks?error=${encodeURIComponent(error.message)}`);
  await logToolCall({ teamId: team.id, actor: member.slack_user_id, tool: "save_playbook", kind: "internal", input: { name, via: "dashboard" }, status: "ok" });
  revalidatePath("/dashboard/playbooks");
  redirect("/dashboard/playbooks");
}

export async function deletePlaybook(form: FormData) {
  const { supabase } = await requireMember();
  await supabase.from("playbooks").delete().eq("id", s(form, "id"));
  revalidatePath("/dashboard/playbooks");
}

export async function addMemory(form: FormData) {
  const { supabase, member, team } = await requireMember();
  const fact = s(form, "fact").slice(0, 500);
  if (fact) await supabase.from("memories").insert({ team_id: team.id, fact, created_by: `dashboard:${member.slack_user_id}` });
  revalidatePath("/dashboard/playbooks");
}

export async function deleteMemory(form: FormData) {
  const { supabase } = await requireMember();
  await supabase.from("memories").delete().eq("id", s(form, "id"));
  revalidatePath("/dashboard/playbooks");
}

async function resolveChannel(teamId: string, input: string): Promise<string | null> {
  const raw = input.replace(/^#/, "");
  if (/^[CG][A-Z0-9]{6,}$/.test(raw)) return raw;
  const token = await getBotToken(teamId);
  if (!token) return null;
  const res = await slackCall<{ ok: boolean; channels: Array<{ id: string; name: string }> }>("conversations.list", token, {
    types: "public_channel,private_channel", exclude_archived: true, limit: 1000,
  });
  return res.channels.find((c) => c.name === raw.toLowerCase())?.id ?? null;
}

export async function createSchedule(form: FormData) {
  const { supabase, member, team } = await requireMember();
  const cron = s(form, "cron");
  const timezone = s(form, "timezone") || team.timezone;
  const channel = await resolveChannel(team.id, s(form, "channel"));
  if (!channel) redirect(`/dashboard/schedules?error=${encodeURIComponent("Channel not found. Invite the bot to it, then use #name or the channel id.")}`);
  let next: Date;
  try {
    next = parseSchedule(cron, timezone).next;
  } catch (e) {
    redirect(`/dashboard/schedules?error=${encodeURIComponent(e instanceof ScheduleError ? e.message : "Invalid schedule")}`);
  }
  const { error } = await supabase.from("schedules").insert({
    team_id: team.id, name: s(form, "name").slice(0, 120) || "Untitled", cron, timezone, channel_id: channel,
    prompt: s(form, "prompt").slice(0, 4000), created_by: member.slack_user_id, next_run_at: next.toISOString(),
  });
  if (error) redirect(`/dashboard/schedules?error=${encodeURIComponent(error.message)}`);
  revalidatePath("/dashboard/schedules");
  redirect("/dashboard/schedules");
}

export async function toggleSchedule(form: FormData) {
  const { supabase } = await requireMember();
  const id = s(form, "id");
  const enable = s(form, "enable") === "1";
  const { data } = await supabase.from("schedules").select("cron, timezone").eq("id", id).single();
  const patch: Record<string, unknown> = { enabled: enable };
  if (enable && data) patch.next_run_at = parseSchedule(data.cron, data.timezone, new Date(), 0).next.toISOString();
  await supabase.from("schedules").update(patch).eq("id", id);
  revalidatePath("/dashboard/schedules");
}

export async function deleteSchedule(form: FormData) {
  const { supabase } = await requireMember();
  await supabase.from("schedules").delete().eq("id", s(form, "id"));
  revalidatePath("/dashboard/schedules");
}

export async function updateSettings(form: FormData) {
  const { supabase, member, team } = await requireMember();
  if (!member.is_admin) redirect("/dashboard/settings?error=admin_only");
  const autonomy = s(form, "autonomy") as Autonomy;
  const allowed = form.getAll("allowed").map(String).filter(Boolean);
  const admins = form.getAll("admins").map(String).filter(Boolean);
  const patch = {
    autonomy: ["ask_writes", "ask_external", "full_auto"].includes(autonomy) ? autonomy : team.autonomy,
    allowed_user_ids: s(form, "everyone") === "1" ? [] : allowed,
    admin_user_ids: admins,
    model: s(form, "model") || null,
    max_steps: Math.min(30, Math.max(1, Number(s(form, "max_steps")) || team.max_steps)),
    max_tokens: Math.min(500000, Math.max(2000, Number(s(form, "max_tokens")) || team.max_tokens)),
    timezone: s(form, "timezone") || team.timezone,
  };
  const { error } = await supabase.from("teams").update(patch).eq("id", team.id);
  if (error) redirect(`/dashboard/settings?error=${encodeURIComponent(error.message)}`);
  // Keep dashboard admin flags in sync (service role: members rows are server-managed).
  const { data: rows } = await db().from("members").select("auth_user_id, slack_user_id").eq("team_id", team.id);
  for (const r of rows ?? []) {
    const isAdm = r.slack_user_id === team.installer_user_id || admins.includes(r.slack_user_id);
    await db().from("members").update({ is_admin: isAdm }).eq("team_id", team.id).eq("auth_user_id", r.auth_user_id);
  }
  await logToolCall({ teamId: team.id, actor: member.slack_user_id, tool: "update_settings", kind: "internal", input: patch, status: "ok" });
  revalidatePath("/dashboard", "layout");
  redirect("/dashboard/settings?saved=1");
}

/** Delete every trace of this workspace: Slack token (revoked), app connections, and all rows (cascade). */
export async function deleteAllData(form: FormData) {
  const { supabase, member, team } = await requireMember();
  if (!member.is_admin) redirect("/dashboard/settings?error=admin_only");
  if (s(form, "confirm") !== team.name) redirect("/dashboard/settings?error=confirm");

  const token = await getBotToken(team.id);
  const users = new Set<string>([team.installer_user_id]);
  for (const table of ["members", "jobs", "schedules"] as const) {
    const col = table === "members" ? "slack_user_id" : table === "jobs" ? "slack_user_id" : "created_by";
    const { data } = await db().from(table).select(col).eq("team_id", team.id).limit(5000);
    for (const r of (data ?? []) as unknown as Record<string, string>[]) if (r[col]) users.add(r[col]);
  }
  try {
    await deleteConnectionsForUsers([...users].map((u) => composioUserId(team.id, u)));
  } catch (e) {
    console.error("composio cleanup failed", e);
  }
  if (token) await slackCall("auth.revoke", token).catch(() => {});
  await db().from("teams").delete().eq("id", team.id); // cascades to every table
  await supabase.auth.signOut();
  redirect("/?deleted=1");
}
