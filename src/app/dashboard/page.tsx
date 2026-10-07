import Link from "next/link";
import { requireMember } from "@/lib/auth";
import { composioUserId, listConnectedApps } from "@/lib/agent/composio";
import { AUTONOMY_LABELS } from "@/lib/agent/approval";
import { PRODUCT_NAME } from "@/lib/config";
import { Empty, PageHeader, StatusPill, daysAgoIso, timeAgo } from "./ui";

export const dynamic = "force-dynamic";

export default async function Overview() {
  const { supabase, team, member } = await requireMember();
  const weekAgo = daysAgoIso(7);
  const [jobs, weekCount, pending, playbooks, schedules, apps] = await Promise.all([
    supabase.from("jobs").select("id, prompt, status, source, created_at, input_tokens, output_tokens").eq("team_id", team.id).order("created_at", { ascending: false }).limit(8),
    supabase.from("jobs").select("id", { count: "exact", head: true }).eq("team_id", team.id).gte("created_at", weekAgo),
    supabase.from("approvals").select("id", { count: "exact", head: true }).eq("team_id", team.id).eq("status", "pending"),
    supabase.from("playbooks").select("id", { count: "exact", head: true }).eq("team_id", team.id),
    supabase.from("schedules").select("id", { count: "exact", head: true }).eq("team_id", team.id),
    listConnectedApps(composioUserId(team.id, member.slack_user_id)).catch(() => []),
  ]);

  const steps = [
    { done: apps.length > 0, title: "Connect your tools", href: "/dashboard/connections", cta: "Connect an app" },
    { done: (playbooks.count ?? 0) > 0, title: "Teach it a playbook", href: "/dashboard/playbooks", cta: "Add a playbook" },
    { done: (jobs.data?.length ?? 0) > 0, title: `Hand off a task: mention @${PRODUCT_NAME} in Slack`, href: "slack://open", cta: "Open Slack" },
  ];
  const stats = [
    { label: "Tasks this week", value: weekCount.count ?? 0 },
    { label: "Waiting for approval", value: pending.count ?? 0 },
    { label: "Schedules", value: schedules.count ?? 0 },
    { label: "Tokens used (all time)", value: Number(team.tokens_used_total).toLocaleString() },
  ];

  return (
    <>
      <PageHeader title="Overview" description={`Autonomy: ${AUTONOMY_LABELS[team.autonomy]}`} />

      {steps.some((s) => !s.done) && (
        <section className="card mb-10">
          <h2 className="font-semibold">Get started</h2>
          <ol className="mt-4 space-y-3">
            {steps.map((s, i) => (
              <li key={i} className="flex items-center justify-between gap-4">
                <span className={s.done ? "text-neutral-400 line-through" : ""}>
                  {s.done ? "✓" : `${i + 1}.`} {s.title}
                </span>
                {!s.done && <Link href={s.href} className="btn-ghost">{s.cta}</Link>}
              </li>
            ))}
          </ol>
        </section>
      )}

      <section className="mb-12 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="card">
            <p className="muted">{s.label}</p>
            <p className="mt-2 text-2xl font-semibold">{s.value}</p>
          </div>
        ))}
      </section>

      <h2 className="mb-4 font-semibold">Recent tasks</h2>
      {jobs.data?.length ? (
        <ul className="divide-y divide-neutral-100 rounded-xl border border-neutral-200">
          {jobs.data.map((j) => (
            <li key={j.id} className="flex items-center justify-between gap-4 px-5 py-4">
              <div className="min-w-0">
                <p className="truncate">{j.prompt}</p>
                <p className="muted mt-1">{j.source} · {timeAgo(j.created_at)} · {(j.input_tokens + j.output_tokens).toLocaleString()} tokens</p>
              </div>
              <StatusPill status={j.status} />
            </li>
          ))}
        </ul>
      ) : (
        <Empty>No tasks yet. Mention @{PRODUCT_NAME} in a channel or send it a DM.</Empty>
      )}
    </>
  );
}
