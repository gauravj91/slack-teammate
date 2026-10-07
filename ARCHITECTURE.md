# Architecture

```
 Slack ──events/buttons──▶  Vercel (Next.js route handlers)  ──▶ Supabase Postgres
   ▲                           │  verify signature, enqueue job,      (teams, jobs, approvals,
   │                           │  ack < 3 s, then waitUntil(run)       playbooks, schedules, audit)
   │                           ▼                                              ▲
   └──chat.update / post── Agent loop (Claude + tools) ──Composio──▶ HubSpot, Gmail, Notion…
                               ▲
 Supabase pg_cron ──every minute, pg_net POST──▶ /api/cron/tick (due schedules + drain queue)
```

## Request flow

1. **Slack event** (`/api/slack/events`): verify HMAC signature (`src/lib/slack/verify.ts`), ignore retries, insert a `jobs` row (unique `event_id` de-duplicates), return 200 immediately. The work continues in `waitUntil` (Vercel keeps the function alive up to `maxDuration`, 300 s on Hobby).
2. **Worker** (`src/lib/worker.ts` → `processJob` in `src/lib/agent/run.ts`): claims jobs atomically with `claim_jobs()` (`FOR UPDATE SKIP LOCKED`), posts a "Working on it…" message in the thread and edits it as steps happen.
3. **Agent loop**: Claude Messages API with tool use. Each step: call model → execute allowed tool calls → append `tool_result` → repeat until the model answers, the per-task step/token budget is hit (then one final no-tools call for a summary), or ~240 s elapse.
4. **Long tasks**: when the time budget is reached the full conversation is saved in `jobs.state`, the job goes back to `queued`, and a fresh invocation is kicked (`/api/worker`). The every-minute tick also picks up anything queued or any job whose worker died (`locked_until` expired). Tasks therefore survive the 300 s Hobby limit.
5. **Approvals**: each tool call is classified (`src/lib/agent/approval.ts`) as `read | internal | write | external_send`. The team's autonomy decides which need a human. Gated calls are stored in `approvals` + `jobs.state.pending`, a Block Kit message with Approve/Reject is posted, and the job waits (`awaiting_approval`). The click (`/api/slack/interactions`) is checked (requester or admin, first click wins), recorded, and the job is re-queued; the loop executes or refuses the calls and continues.
6. **Audit**: every tool execution, approval request and decision is written to `audit_log` with a redacted input/result summary and duration.

## Tools available to Claude

- **Native** (`src/lib/agent/tools.ts`): Slack (list channels, read channel/thread, find messages, post message), `web_fetch` (SSRF-guarded), memory (`remember_fact`, `forget_fact`), playbooks (`save_playbook`, `list_playbooks`, `get_playbook`), schedules (`create_schedule`, `list_schedules`, `delete_schedule`), connections (`connect_app`, `list_connections`).
- **Composio session meta tools** (`src/lib/agent/composio.ts`): `COMPOSIO_SEARCH_TOOLS`, `COMPOSIO_GET_TOOL_SCHEMAS`, `COMPOSIO_MULTI_EXECUTE_TOOL`, created per Slack user (`userId = <teamId>:<slackUserId>`) so every call runs on that person's own OAuth connection. Composio's in-chat connection manager is disabled; connect links are sent privately (ephemeral message, modal, or dashboard redirect) so nobody can click someone else's link in a public thread. The approval gate looks inside `COMPOSIO_MULTI_EXECUTE_TOOL` at each `tool_slug`.

## Context and token economy

- System prompt = static block (cached) + dynamic block (time/timezone, autonomy, team facts, top-3 relevant playbooks by keyword score, connected apps).
- Cache breakpoints: last tool definition, static system block, last message (3 of the 4 allowed).
- `output_config.effort` defaults to `low`; model and limits are per-team settings.
- Tool results are truncated to 12k characters; thread context to the last 15 messages.

## Scheduling

`schedules` holds cron + IANA timezone + channel + prompt + owner. `pg_cron` calls `/api/cron/tick` every minute through `pg_net`, with the URL and bearer secret stored in Supabase Vault (`supabase/migrations/0003_cron.sql`). The tick advances `next_run_at` with an optimistic lock (no double fires), enqueues a `schedule` job that runs as the schedule's creator, and drains the queue. Validation and next-run math are in `src/lib/schedule.ts` (cron-parser, DST-aware; minimum interval 15 minutes).

## Data and security

- **Tenancy**: every table has `team_id` (Slack team id). RLS (`0002_rls.sql`) limits dashboard users to teams they are members of (`members` rows are created at sign-in after verifying the Slack OpenID `team_id`). Server code uses the secret key and always filters by `team_id`.
- **Secrets**: Slack bot tokens live in `installations` (RLS on, no policies → service role only), AES-256-GCM encrypted with `ENCRYPTION_KEY`. Third-party OAuth tokens are held by Composio, never in our database.
- **Endpoints**: Slack routes verify signatures with a 5-minute replay window; `/api/cron/tick` and `/api/worker` require `Authorization: Bearer CRON_SECRET` (constant-time compare). OAuth `state` is HMAC-signed and bound to a cookie.
- **Delete my data**: admin action revokes the Slack token, deletes the workspace's Composio connected accounts, and deletes the `teams` row (cascades to everything).

## Code map

```
src/app/                       pages + route handlers
  api/slack/{install,oauth,events,interactions}
  api/cron/tick, api/worker    internal, bearer-protected
  auth/{login,callback,logout} Sign in with Slack (Supabase Auth, slack_oidc)
  dashboard/*                  overview, connections, playbooks, schedules, activity, settings, actions.ts
src/lib/agent/                 run.ts (loop), approval.ts, tools.ts, composio.ts, context.ts, prompt.ts, web.ts
src/lib/slack/                 api.ts, verify.ts, blocks.ts (Block Kit), home.ts (App Home)
src/lib/                       db.ts, jobs.ts, worker.ts, schedule.ts, audit.ts, crypto.ts, config.ts, auth.ts
supabase/migrations/           0001 schema · 0002 RLS · 0003 pg_cron + pg_net
slack/manifest.yml             scopes, events, interactivity, App Home, redirect URLs
tests/                         approval gating, schedule parsing, Slack signatures, crypto, ranking, SSRF guard
```

## Scaling past the free tiers

Move Vercel to Pro (commercial use, 800 s functions), Supabase to Pro (no pausing, backups), and apply for the Slack Marketplace (normal history rate limits). For high volume, replace the Postgres queue with Vercel Queues/Workflows or pgmq, and use Composio custom auth configs (own OAuth apps).
