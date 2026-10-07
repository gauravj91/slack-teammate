import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { decrypt } from "./crypto";
import { requireEnv } from "./config";

export type Autonomy = "ask_writes" | "ask_external" | "full_auto";

export interface Team {
  id: string;
  name: string;
  bot_user_id: string;
  installer_user_id: string;
  autonomy: Autonomy;
  allowed_user_ids: string[];
  admin_user_ids: string[];
  model: string | null;
  max_steps: number;
  max_tokens: number;
  timezone: string;
  tokens_used_total: number;
  installed_at: string;
}

export interface Job {
  id: string;
  team_id: string;
  source: "mention" | "dm" | "schedule" | "home";
  event_id: string | null;
  slack_user_id: string;
  channel_id: string;
  thread_ts: string | null;
  status_ts: string | null;
  prompt: string;
  status: "queued" | "running" | "awaiting_approval" | "done" | "failed" | "cancelled";
  state: Record<string, unknown>;
  steps: number;
  input_tokens: number;
  output_tokens: number;
  attempts: number;
  result: string | null;
  error: string | null;
  schedule_id: string | null;
  created_at: string;
}

export interface Playbook {
  id: string;
  team_id: string;
  name: string;
  content: string;
  created_by: string | null;
  updated_at: string;
}

export interface Schedule {
  id: string;
  team_id: string;
  name: string;
  cron: string;
  timezone: string;
  channel_id: string;
  prompt: string;
  created_by: string;
  enabled: boolean;
  next_run_at: string | null;
  last_run_at: string | null;
}

let admin: SupabaseClient | null = null;

/** Service-role client. Server-only: bypasses RLS, so always filter by team_id. */
export function db(): SupabaseClient {
  if (!admin) {
    admin = createClient(requireEnv("NEXT_PUBLIC_SUPABASE_URL"), requireEnv("SUPABASE_SECRET_KEY"), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return admin;
}

export async function getTeam(teamId: string): Promise<Team | null> {
  const { data } = await db().from("teams").select("*").eq("id", teamId).maybeSingle();
  return (data as Team) ?? null;
}

export async function getBotToken(teamId: string): Promise<string | null> {
  const { data } = await db().from("installations").select("bot_token_enc").eq("team_id", teamId).maybeSingle();
  return data ? decrypt(data.bot_token_enc as string) : null;
}

export function isAdmin(team: Team, slackUserId: string): boolean {
  return team.installer_user_id === slackUserId || team.admin_user_ids.includes(slackUserId);
}

/** Allow-list: empty list means everyone in the workspace may use the teammate. Admins always can. */
export function isAllowed(team: Team, slackUserId: string): boolean {
  if (isAdmin(team, slackUserId)) return true;
  return team.allowed_user_ids.length === 0 || team.allowed_user_ids.includes(slackUserId);
}
