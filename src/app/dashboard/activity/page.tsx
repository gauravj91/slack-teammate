import { requireMember } from "@/lib/auth";
import { Empty, PageHeader, StatusPill } from "../ui";

export const dynamic = "force-dynamic";

const FILTERS = ["all", "ok", "error", "awaiting_approval", "approved", "rejected"];

export default async function Activity({ searchParams }: { searchParams: Promise<{ status?: string; page?: string }> }) {
  const { status = "all", page = "0" } = await searchParams;
  const p = Math.max(0, Number(page) || 0);
  const { supabase, team } = await requireMember();
  let q = supabase.from("audit_log").select("*").eq("team_id", team.id).order("created_at", { ascending: false }).range(p * 50, p * 50 + 49);
  if (status !== "all") q = q.eq("status", status);
  const { data: rows } = await q;

  return (
    <>
      <PageHeader title="Activity" description="Every action your teammate took: who it was for, what it did, and what happened." />
      <div className="mb-6 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <a key={f} href={`/dashboard/activity?status=${f}`} className={`rounded-full px-3 py-1 text-sm ${f === status ? "bg-accent-soft text-accent" : "text-neutral-600 hover:bg-neutral-50"}`}>
            {f.replace("_", " ")}
          </a>
        ))}
      </div>
      {rows?.length ? (
        <div className="overflow-x-auto rounded-xl border border-neutral-200">
          <table className="w-full text-left text-sm">
            <thead className="bg-neutral-50 text-neutral-500">
              <tr><th className="px-4 py-3 font-medium">When</th><th className="px-4 py-3 font-medium">Who</th><th className="px-4 py-3 font-medium">Action</th><th className="px-4 py-3 font-medium">Input</th><th className="px-4 py-3 font-medium">Result</th><th className="px-4 py-3 font-medium">Status</th></tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {rows.map((r) => (
                <tr key={r.id} className="align-top">
                  <td className="whitespace-nowrap px-4 py-3 text-neutral-500">{new Date(r.created_at).toLocaleString("en-GB", { timeZone: team.timezone, dateStyle: "short", timeStyle: "short" })}</td>
                  <td className="px-4 py-3 font-mono text-xs">{r.actor}</td>
                  <td className="px-4 py-3"><span className="font-medium">{r.tool}</span>{r.kind && <span className="muted block">{r.kind.replace("_", " ")}</span>}</td>
                  <td className="max-w-xs px-4 py-3 font-mono text-xs break-words text-neutral-600">{r.input_summary}</td>
                  <td className="max-w-xs px-4 py-3 font-mono text-xs break-words text-neutral-600">{r.result_summary}</td>
                  <td className="px-4 py-3"><StatusPill status={r.status} />{r.duration_ms != null && <span className="muted block">{r.duration_ms} ms</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty>No activity yet.</Empty>
      )}
      <div className="mt-6 flex justify-between">
        {p > 0 ? <a className="btn-ghost" href={`/dashboard/activity?status=${status}&page=${p - 1}`}>← Newer</a> : <span />}
        {rows?.length === 50 && <a className="btn-ghost" href={`/dashboard/activity?status=${status}&page=${p + 1}`}>Older →</a>}
      </div>
    </>
  );
}
