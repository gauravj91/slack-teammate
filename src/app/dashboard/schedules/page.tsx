import { requireMember } from "@/lib/auth";
import { describeCron } from "@/lib/schedule";
import { createSchedule, deleteSchedule, toggleSchedule } from "../actions";
import { Empty, Notice, PageHeader } from "../ui";

export const dynamic = "force-dynamic";

const EXAMPLES = [
  { cron: "0 8 * * 1", label: "Mondays 08:00" },
  { cron: "0 9 * * 1-5", label: "Weekdays 09:00" },
  { cron: "0 17 * * 5", label: "Fridays 17:00" },
  { cron: "0 9 1 * *", label: "1st of month 09:00" },
];

export default async function Schedules({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const { supabase, team } = await requireMember();
  const { data: schedules } = await supabase.from("schedules").select("*").eq("team_id", team.id).order("created_at", { ascending: false });

  return (
    <>
      <PageHeader title="Schedules" description="Recurring work. Easiest in Slack: “every Monday at 8am send the pipeline summary to #sales”." />
      {error && <Notice kind="error">{error}</Notice>}

      <section className="card mb-10">
        <h2 className="font-semibold">New schedule</h2>
        <form action={createSchedule} className="mt-4 grid gap-4 sm:grid-cols-2">
          <div><label className="label" htmlFor="name">Name</label><input id="name" name="name" required placeholder="Pipeline summary" className="input" /></div>
          <div><label className="label" htmlFor="channel">Post to channel</label><input id="channel" name="channel" required placeholder="#sales" className="input" /></div>
          <div>
            <label className="label" htmlFor="cron">When (cron)</label>
            <input id="cron" name="cron" required placeholder="0 8 * * 1" className="input font-mono" list="cron-examples" />
            <datalist id="cron-examples">{EXAMPLES.map((e) => <option key={e.cron} value={e.cron}>{e.label}</option>)}</datalist>
            <p className="muted mt-1">minute hour day month weekday · e.g. {EXAMPLES.map((e) => `${e.cron} = ${e.label}`).join(", ")}</p>
          </div>
          <div><label className="label" htmlFor="timezone">Timezone</label><input id="timezone" name="timezone" defaultValue={team.timezone} className="input" /></div>
          <div className="sm:col-span-2">
            <label className="label" htmlFor="prompt">What should it do?</label>
            <textarea id="prompt" name="prompt" required rows={3} placeholder="Summarise open HubSpot deals closing this month, grouped by owner." className="input" />
          </div>
          <div className="sm:col-span-2"><button className="btn-primary">Create schedule</button></div>
        </form>
        <p className="muted mt-4">Runs use the connected apps of the person who created the schedule.</p>
      </section>

      {schedules?.length ? (
        <ul className="space-y-3">
          {schedules.map((s) => (
            <li key={s.id} className="card flex flex-wrap items-center justify-between gap-4">
              <div className="min-w-0">
                <h3 className="font-medium">{s.name} {!s.enabled && <span className="muted">(paused)</span>}</h3>
                <p className="muted mt-1">{describeCron(s.cron, s.timezone)} · posts to &lt;#{s.channel_id}&gt;</p>
                <p className="mt-2 text-sm text-neutral-600">{s.prompt}</p>
                {s.next_run_at && s.enabled && <p className="muted mt-1">Next run: {new Date(s.next_run_at).toLocaleString("en-GB", { timeZone: s.timezone })}</p>}
              </div>
              <div className="flex gap-2">
                <form action={toggleSchedule}><input type="hidden" name="id" value={s.id} /><input type="hidden" name="enable" value={s.enabled ? "0" : "1"} /><button className="btn-ghost">{s.enabled ? "Pause" : "Resume"}</button></form>
                <form action={deleteSchedule}><input type="hidden" name="id" value={s.id} /><button className="btn-danger">Delete</button></form>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <Empty>No schedules yet.</Empty>
      )}
    </>
  );
}
