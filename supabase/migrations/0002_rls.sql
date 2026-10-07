-- Teammate: row-level security.
-- The Slack bot/worker uses the service-role (secret) key and bypasses RLS.
-- Dashboard users use the publishable key + their Supabase Auth session, so every
-- query is limited to the workspace(s) they belong to.

alter table public.teams         enable row level security;
alter table public.installations enable row level security;  -- no policies: service role only
alter table public.members       enable row level security;
alter table public.playbooks     enable row level security;
alter table public.memories      enable row level security;
alter table public.schedules     enable row level security;
alter table public.jobs          enable row level security;
alter table public.approvals     enable row level security;
alter table public.audit_log     enable row level security;

-- Helpers (security definer so they can read members without recursive RLS).
create or replace function public.is_team_member(p_team_id text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.members m where m.team_id = p_team_id and m.auth_user_id = auth.uid());
$$;

create or replace function public.is_team_admin(p_team_id text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.members m
                  where m.team_id = p_team_id and m.auth_user_id = auth.uid() and m.is_admin);
$$;

grant execute on function public.is_team_member(text) to authenticated;
grant execute on function public.is_team_admin(text) to authenticated;

-- teams: members read, admins update settings.
drop policy if exists teams_select on public.teams;
create policy teams_select on public.teams for select to authenticated using (public.is_team_member(id));
drop policy if exists teams_update on public.teams;
create policy teams_update on public.teams for update to authenticated
  using (public.is_team_admin(id)) with check (public.is_team_admin(id));

-- members: see your teammates' rows; rows are created by the server on sign-in.
drop policy if exists members_select on public.members;
create policy members_select on public.members for select to authenticated using (public.is_team_member(team_id));

-- playbooks / memories / schedules: any member can manage.
drop policy if exists playbooks_all on public.playbooks;
create policy playbooks_all on public.playbooks for all to authenticated
  using (public.is_team_member(team_id)) with check (public.is_team_member(team_id));

drop policy if exists memories_all on public.memories;
create policy memories_all on public.memories for all to authenticated
  using (public.is_team_member(team_id)) with check (public.is_team_member(team_id));

drop policy if exists schedules_all on public.schedules;
create policy schedules_all on public.schedules for all to authenticated
  using (public.is_team_member(team_id)) with check (public.is_team_member(team_id));

-- jobs / approvals / audit: read-only from the dashboard.
drop policy if exists jobs_select on public.jobs;
create policy jobs_select on public.jobs for select to authenticated using (public.is_team_member(team_id));

drop policy if exists approvals_select on public.approvals;
create policy approvals_select on public.approvals for select to authenticated using (public.is_team_member(team_id));

drop policy if exists audit_select on public.audit_log;
create policy audit_select on public.audit_log for select to authenticated using (public.is_team_member(team_id));

-- The anon role gets nothing.
revoke all on all tables in schema public from anon;
