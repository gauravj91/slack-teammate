-- Teammate: core schema
-- Run in the Supabase SQL editor (or `supabase db push`). Safe to run once on a fresh project.

create extension if not exists pgcrypto;

-- One row per installed Slack workspace. Installing the app creates the team (no signup form).
create table if not exists public.teams (
  id                text primary key,              -- Slack team id (T0123...)
  name              text not null,
  bot_user_id       text not null,
  installer_user_id text not null,
  installed_at      timestamptz not null default now(),
  -- Control settings
  autonomy          text not null default 'ask_writes'
                    check (autonomy in ('ask_writes', 'ask_external', 'full_auto')),
  allowed_user_ids  text[] not null default '{}',  -- empty = everyone in the workspace
  admin_user_ids    text[] not null default '{}',  -- installer is always an admin
  model             text,                           -- null = use ANTHROPIC_MODEL env default
  max_steps         int  not null default 8  check (max_steps between 1 and 30),
  max_tokens        int  not null default 60000 check (max_tokens between 2000 and 500000),
  timezone          text not null default 'UTC',
  tokens_used_total bigint not null default 0
);

-- Secrets live in their own table, readable only with the service-role key (no RLS policies).
create table if not exists public.installations (
  team_id        text primary key references public.teams(id) on delete cascade,
  bot_token_enc  text not null,                    -- AES-256-GCM, see src/lib/crypto.ts
  scope          text,
  app_id         text,
  enterprise_id  text,
  updated_at     timestamptz not null default now()
);

-- Dashboard users (Supabase Auth users mapped to a Slack workspace). Used by RLS.
create table if not exists public.members (
  auth_user_id  uuid not null references auth.users(id) on delete cascade,
  team_id       text not null references public.teams(id) on delete cascade,
  slack_user_id text not null,
  name          text,
  email         text,
  is_admin      boolean not null default false,
  created_at    timestamptz not null default now(),
  primary key (auth_user_id, team_id)
);
create index if not exists members_team_idx on public.members(team_id);

-- Named processes the agent follows ("how we do X").
create table if not exists public.playbooks (
  id          uuid primary key default gen_random_uuid(),
  team_id     text not null references public.teams(id) on delete cascade,
  name        text not null,
  content     text not null,
  created_by  text,                                -- Slack user id or 'dashboard:<email>'
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (team_id, name)
);

-- Short facts about the team ("our fiscal year starts in April").
create table if not exists public.memories (
  id          uuid primary key default gen_random_uuid(),
  team_id     text not null references public.teams(id) on delete cascade,
  fact        text not null,
  created_by  text,
  created_at  timestamptz not null default now()
);
create index if not exists memories_team_idx on public.memories(team_id, created_at desc);

-- Recurring tasks ("every Monday 8am send the pipeline summary to #sales").
create table if not exists public.schedules (
  id           uuid primary key default gen_random_uuid(),
  team_id      text not null references public.teams(id) on delete cascade,
  name         text not null,
  cron         text not null,
  timezone     text not null default 'UTC',
  channel_id   text not null,
  prompt       text not null,
  created_by   text not null,                      -- Slack user id; tasks run with this user's connections
  enabled      boolean not null default true,
  next_run_at  timestamptz,
  last_run_at  timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists schedules_due_idx on public.schedules(next_run_at) where enabled;

-- Work queue. Every task (mention, DM, schedule run, approval resume) is a job.
create table if not exists public.jobs (
  id             uuid primary key default gen_random_uuid(),
  team_id        text not null references public.teams(id) on delete cascade,
  source         text not null check (source in ('mention', 'dm', 'schedule', 'home')),
  event_id       text unique,                      -- Slack event id, for de-duplication
  slack_user_id  text not null,                    -- who asked (or schedule owner)
  channel_id     text not null,
  thread_ts      text,
  status_ts      text,                             -- the "working..." message we keep updating
  prompt         text not null,
  status         text not null default 'queued'
                 check (status in ('queued', 'running', 'awaiting_approval', 'done', 'failed', 'cancelled')),
  state          jsonb not null default '{}'::jsonb, -- conversation + progress, persisted between runs
  steps          int not null default 0,
  input_tokens   int not null default 0,
  output_tokens  int not null default 0,
  attempts       int not null default 0,
  locked_until   timestamptz,
  result         text,
  error          text,
  schedule_id    uuid references public.schedules(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists jobs_queue_idx on public.jobs(status, created_at);
create index if not exists jobs_team_idx on public.jobs(team_id, created_at desc);

-- Pending human approvals for write actions.
create table if not exists public.approvals (
  id            uuid primary key default gen_random_uuid(),
  team_id       text not null references public.teams(id) on delete cascade,
  job_id        uuid not null references public.jobs(id) on delete cascade,
  tool_calls    jsonb not null,                    -- [{id, name, input, kind}]
  status        text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'expired')),
  requested_by  text not null,
  decided_by    text,
  channel_id    text,
  message_ts    text,
  created_at    timestamptz not null default now(),
  decided_at    timestamptz
);
create index if not exists approvals_job_idx on public.approvals(job_id);

-- Audit trail: every tool call.
create table if not exists public.audit_log (
  id              bigint generated always as identity primary key,
  team_id         text not null references public.teams(id) on delete cascade,
  job_id          uuid references public.jobs(id) on delete set null,
  actor           text,                             -- Slack user id the action ran for
  tool            text not null,
  kind            text,                             -- read | write | external_send | internal
  input_summary   text,
  result_summary  text,
  status          text not null,                    -- ok | error | awaiting_approval | approved | rejected | blocked
  duration_ms     int,
  created_at      timestamptz not null default now()
);
create index if not exists audit_team_idx on public.audit_log(team_id, created_at desc);

-- Claim jobs atomically (multiple workers can run at once without double-processing).
create or replace function public.claim_jobs(p_limit int default 3, p_job_id uuid default null)
returns setof public.jobs
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  update public.jobs j
     set status = 'running',
         attempts = j.attempts + 1,
         locked_until = now() + interval '6 minutes',
         updated_at = now()
   where j.id in (
     select id from public.jobs
      where (p_job_id is null or id = p_job_id)
        and (
          status = 'queued'
          -- a worker died mid-run (e.g. hit the function time limit): pick it up again
          or (status = 'running' and locked_until < now())
        )
        and attempts < 6
      order by created_at
      limit p_limit
      for update skip locked
   )
  returning j.*;
end;
$$;

revoke all on function public.claim_jobs(int, uuid) from public, anon, authenticated;

-- Add token usage to a team's running total.
create or replace function public.add_team_tokens(p_team_id text, p_tokens bigint)
returns void
language sql
security definer
set search_path = public
as $$
  update public.teams set tokens_used_total = tokens_used_total + p_tokens where id = p_team_id;
$$;

revoke all on function public.add_team_tokens(text, bigint) from public, anon, authenticated;
