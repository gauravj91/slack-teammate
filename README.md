# Teammate

An AI teammate for Slack. It doesn't just chat, it does the work.

- **Has its own Slack identity.** Mention it in a channel or DM it. It replies in a thread, shows a live "working…" status with each step, then the result.
- **Uses your team's tools.** Hundreds of apps through [Composio](https://composio.dev) (HubSpot, Gmail, Notion, Linear, Google Sheets, Jira, GitHub…). Every person connects their own account.
- **Learns how you work.** Playbooks (named processes) and team facts, taught in chat ("remember how we do weekly reporting: …"), from an uploaded doc, or in the dashboard.
- **Works on a schedule.** "Every Monday 8am post the pipeline summary to #sales" becomes a schedule.
- **Asks before it acts.** Per-workspace autonomy setting; write actions show Approve / Reject buttons and resume on click. Allow-list, per-task step and token limits.
- **Keeps an audit trail.** Every tool call is logged and visible in the dashboard.
- **Self-serve.** Installing creates the workspace's account. The Slack Home tab is the onboarding guide. A small web dashboard (Sign in with Slack) handles connections, playbooks, schedules, activity and settings.

The product name is a placeholder. Change `NEXT_PUBLIC_PRODUCT_NAME` (and the name in `slack/manifest.yml`) to rename it.

Stack: Next.js 16 (App Router, TypeScript, Tailwind) on Vercel · Supabase (Postgres, Auth, pg_cron, pg_net, Vault) · Anthropic Claude (tool use, prompt caching) · Composio (third-party apps) · Slack Web API (native). See [ARCHITECTURE.md](ARCHITECTURE.md).

---

## What it costs

Everything below is $0 until you have real usage, **except Claude API calls, which are pay-as-you-go from the first task.**

| Service | Free tier (checked October 2026) | Where costs start |
|---|---|---|
| **Vercel Hobby** | 1M function invocations, 4 active CPU-hours, 360 GB-hrs memory, 100 GB transfer per month; functions run up to 300 s. | **Hobby is for non-commercial, personal use only** ([Hobby plan](https://vercel.com/docs/plans/hobby), [fair use](https://vercel.com/docs/limits/fair-use-guidelines#commercial-usage)). Move to **Pro ($20/user/month)** before you charge customers. If you exceed Hobby limits, features pause until the 30-day window resets. |
| **Supabase Free** | 500 MB database, 50,000 monthly active users, 5 GB egress, 2 active projects; pg_cron, pg_net and Vault included. | Free projects **pause after 1 week of inactivity** (the every-minute cron call should keep it active, but check). Pro is from $25/month (no pausing, backups). [Pricing](https://supabase.com/pricing) |
| **Composio Hobby** | 100,000 tool calls/month (up to 20,000 of them when using Composio's own OAuth apps), unlimited connected accounts, sessions free, hard-capped (no surprise bill). | Pro $29/month incl. credit, then $0.0003 per tool call. Bring your own OAuth apps for the full free allowance. [Pricing](https://composio.dev/pricing) |
| **Slack** | Free workspaces can install apps. Distributing to other workspaces is free. | No fees. But see the **rate-limit note** below. |
| **Anthropic Claude** | No free tier. | Default `claude-sonnet-5-5`: $2 per M input / $10 per M output tokens; `claude-haiku-4-5`: $1 / $5 (retiring no sooner than 2026-10-15). A typical task with prompt caching and effort `low` uses roughly 5k–30k tokens (≈ $0.01–$0.10). Each task is capped by "Max tokens per task" (default 60,000). [Models & pricing](https://platform.claude.com/docs/en/models/overview) |

**Token-saving choices already built in:** prompt caching on tools + system prompt + conversation, `effort: low` by default, Composio "meta tools" (a handful of tool definitions instead of hundreds), only the 3 most relevant playbooks injected, tool outputs truncated, per-task step/token budgets.

**Slack rate-limit note.** Since May 2025, apps installed in *other* workspaces that are **not approved for the Slack Marketplace** may call `conversations.history` / `conversations.replies` only **once per minute, 15 messages per call** ([Slack changelog](https://docs.slack.dev/changelog/2025/05/29/rate-limit-changes-for-non-marketplace-apps)). Mentions, DMs, posting and approvals are unaffected; reading channel history is slow. Your own workspace (internal use) is not limited: set `SLACK_HISTORY_LIMIT=100` there. Apply for the Slack Marketplace when you start distributing.

---

## Set it up (zero to deployed, about 45 minutes)

You'll create five free accounts, copy some keys into Vercel, and paste two files. No coding needed.

### What you need

1. A **GitHub** account (to deploy from) - github.com
2. A **Vercel** account (sign in with GitHub) - vercel.com
3. A **Supabase** account - supabase.com
4. A **Slack workspace** where you can install apps - slack.com
5. An **Anthropic** account with billing enabled - console.anthropic.com
6. A **Composio** account (optional but recommended) - dashboard.composio.dev

Keep a notes file open: you will collect about ten values.

### Step 1 - Generate two secrets

On any computer with Node.js (or ask a developer friend), run:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"   # ENCRYPTION_KEY
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"      # CRON_SECRET
```

Save both. Don't lose `ENCRYPTION_KEY`: changing it later means every workspace has to reinstall.

### Step 2 - Deploy to Vercel (first pass)

1. Push this folder to a GitHub repository (private is fine).
2. In Vercel: **Add New → Project → Import** your repository. Framework: Next.js (auto-detected). Click **Deploy**. The first deploy may show errors on pages that need keys; that's fine.
3. Note your production URL, e.g. `https://teammate-xyz.vercel.app`. This is `NEXT_PUBLIC_APP_URL`.

### Step 3 - Supabase project and database

1. In Supabase: **New project**. Pick a region near your users and a strong database password.
2. When it's ready, open **SQL Editor → New query**, paste the whole of `supabase/migrations/0001_schema.sql`, click **Run**. Then do the same with `0002_rls.sql`.
3. Open `supabase/migrations/0003_cron.sql` in a text editor, replace `https://YOUR-APP.vercel.app` with your Vercel URL and `YOUR_CRON_SECRET` with your `CRON_SECRET`. Paste it into a new query and **Run**. (This calls your app every minute to run schedules and background work.)
4. **Settings → API Keys**: copy the **Project URL** (`NEXT_PUBLIC_SUPABASE_URL`), the **publishable key** (`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`) and the **secret key** (`SUPABASE_SECRET_KEY`). On older projects these are called the `anon` and `service_role` keys.
5. Note your **project ref** (the `abcd1234` in `https://abcd1234.supabase.co`).

### Step 4 - Create the Slack app from the manifest

1. Open `slack/manifest.yml` and replace `your-app.vercel.app` (3 places) with your Vercel domain and `YOUR-PROJECT-REF` with your Supabase project ref.
2. Go to **api.slack.com/apps → Create New App → From an app manifest**, choose your workspace, paste the edited manifest, **Create**.
3. **Basic Information → App Credentials**: copy **Client ID**, **Client Secret**, **Signing Secret**.
4. Optional: upload an app icon under **Basic Information → Display Information**.
5. To let *other* workspaces install it: **Manage Distribution → Activate Public Distribution** (tick the checklist). You can skip this while testing in your own workspace.

> Slack checks the Events URL when you save the manifest. If it says the URL didn't respond, finish Step 7 (env vars + redeploy), then go to **Event Subscriptions** and click **Retry**.

### Step 5 - Turn on "Sign in with Slack" in Supabase

1. Supabase → **Authentication → Sign In / Providers → Slack (OIDC)** → enable it, paste the Slack **Client ID** and **Client Secret** from Step 4, **Save**.
2. Supabase → **Authentication → URL Configuration**: set **Site URL** to your Vercel URL and add `https://your-app.vercel.app/auth/callback` to **Redirect URLs**.

### Step 6 - Anthropic and Composio keys

1. **Anthropic**: console.anthropic.com → add billing → **API Keys → Create key** → `ANTHROPIC_API_KEY`. Tip: set a monthly spend limit under **Limits**.
2. **Composio**: dashboard.composio.dev → create a project → **Settings → API Keys** → `COMPOSIO_API_KEY`.
   - **Auth configs:** nothing to set up to start. Composio uses its own managed OAuth apps by default, so HubSpot, Gmail, Notion, Linear, Google Sheets, etc. work immediately. Later, for your own branding and the full free allowance, create a custom auth config per app in the Composio dashboard (**Auth Configs → Create**, choose "use your own developer app") and Composio uses it automatically.
   - Some apps need an API key instead of OAuth; the connect link asks the user for it.

### Step 7 - Add environment variables in Vercel and redeploy

Vercel → your project → **Settings → Environment Variables**. Add every variable from `.env.example` (each line is explained there):

`NEXT_PUBLIC_PRODUCT_NAME`, `NEXT_PUBLIC_APP_URL`, `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `SLACK_SIGNING_SECRET`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `COMPOSIO_API_KEY`, `ENCRYPTION_KEY`, `CRON_SECRET` (optional: `ANTHROPIC_EFFORT`, `SLACK_HISTORY_LIMIT`).

Then **Deployments → ⋯ → Redeploy**.

### Step 8 - Test it

1. Open your Vercel URL → **Add to Slack** → Allow. You land on a "Teammate is in your workspace" page and get a welcome DM.
2. In Slack, open the app → **Home** tab: you see the 3-step guide.
3. **Connect an app:** click *Connect an app* → pick e.g. Gmail → *Get link* → sign in. (Or DM it: "connect HubSpot"; the link arrives privately.)
4. **Talk to it:** DM "what can you do?", or invite it to a channel (`/invite @Teammate`) and write `@Teammate summarise the last messages here`. You should see a status message that updates with steps, then the answer.
5. **Approval:** ask for a change, e.g. `@Teammate draft and send an email to me@example.com saying hi`. With the default autonomy you get **Approve / Reject** buttons; approve and it continues.
6. **Teach it:** `@Teammate remember how we do weekly reporting: 1) … 2) …` then check **Dashboard → Playbooks**. You can also attach a `.md` / `.txt` file to a DM and say "learn this as our onboarding playbook".
7. **Schedule:** `@Teammate every weekday at 9am post a one-line motivational quote here`. Check **Dashboard → Schedules**. It runs on the next matching minute.
8. **Dashboard:** your Vercel URL → **Sign in** → *Sign in with Slack*. Look at Overview, Activity (every tool call), Settings (autonomy, allowed users, model, limits, delete all data).

**Checking the background runner:** in Supabase SQL Editor run `select * from cron.job_run_details order by start_time desc limit 5;` and `select status_code, content from net._http_response order by created desc limit 5;`. You want status `200`. A `401` means `CRON_SECRET` differs between Vercel and the SQL file.

### Troubleshooting

| Symptom | Fix |
|---|---|
| Slack says the Events URL failed verification | Env vars missing or not redeployed. Check `SLACK_SIGNING_SECRET`, redeploy, click Retry in Event Subscriptions. |
| "Add to Slack" ends on `?install=failed` | Check `SLACK_CLIENT_ID/SECRET`, `ENCRYPTION_KEY` (must decode to 32 bytes), Supabase keys, and that the redirect URL in the manifest matches `NEXT_PUBLIC_APP_URL`. |
| Dashboard sign-in says workspace not installed | Install the app first, and sign in with an account from that workspace. Check Supabase redirect URLs (Step 5). |
| Bot never answers | Vercel → Logs. Common causes: missing `ANTHROPIC_API_KEY`, bot not invited to the channel. |
| "I'm not a member of that channel" | `/invite @Teammate` in that channel. |
| Schedules don't run | Check the cron queries above; the Vercel URL in Vault must be the production URL. |

### Local development

```bash
cp .env.example .env.local   # fill in values
npm install
npm run dev                  # http://localhost:3000
```

Slack needs a public HTTPS URL for events: use a tunnel (e.g. `cloudflared tunnel --url http://localhost:3000`) and point a separate dev Slack app at it.

```bash
npm run lint && npm run typecheck && npm test && npm run build
```

---

## Using it

- **Mention** `@Teammate` in a channel or **DM** it. It replies in a thread and keeps the thread's earlier messages as context.
- **Connect apps:** "connect notion", the Home tab, or Dashboard → Connections. Connections are personal; scheduled tasks use the connections of whoever created the schedule.
- **Teach:** "remember how we …" (playbook), "remember that …" (fact), attach a text/markdown doc, Home tab → *Add a playbook*, or the dashboard.
- **Schedules:** say it in plain words; it converts to cron in your timezone. Minimum interval 15 minutes.
- **Autonomy** (Settings): *Ask before any change* (default) · *Ask only before sending things to people* · *Full auto*. The requester or an admin can approve.
- **Allow-list** (Settings): everyone, or chosen people. Admins always have access.
- **Limits** (Settings): max steps and max tokens per task; model per workspace.
- **Delete all data** (Settings, admins): removes every row for the workspace, all app connections, and revokes the Slack token.

## Known limits of this prototype

- Reading channel history is rate-limited by Slack for non-Marketplace apps (see above). Slack message *search* by bots isn't available, so `slack_find_messages` scans a few recent messages in up to 3 channels.
- Uploaded docs: plain text / Markdown / CSV / JSON only (no PDF or Word parsing yet).
- Playbook relevance is keyword-based; switch to pgvector embeddings when a team has hundreds.
- Approval classification is heuristic (by tool name verbs; unknown verbs count as writes, which is the safe default).
- `web_fetch` blocks private/internal addresses by hostname; it does not re-check after redirects or DNS resolution.
- No billing/subscriptions yet; and Vercel Hobby must be upgraded before charging customers.
