import { redirect } from "next/navigation";
import { supabaseServer } from "./supabase/server";
import type { Team } from "./db";

export interface Member {
  auth_user_id: string;
  team_id: string;
  slack_user_id: string;
  name: string | null;
  email: string | null;
  is_admin: boolean;
}

/** Current dashboard member + their team (RLS-scoped). Redirects to /login when signed out. */
export async function requireMember() {
  const supabase = await supabaseServer();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/login");
  const { data: member } = await supabase
    .from("members")
    .select("*")
    .eq("auth_user_id", auth.user.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!member) redirect("/login?error=not_installed");
  const { data: team } = await supabase.from("teams").select("*").eq("id", member.team_id).single();
  if (!team) redirect("/login?error=not_installed");
  return { supabase, member: member as Member, team: team as Team };
}
