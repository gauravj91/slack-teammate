import { requireMember } from "@/lib/auth";
import { addMemory, deleteMemory, deletePlaybook, savePlaybook } from "../actions";
import { Empty, Notice, PageHeader, timeAgo } from "../ui";

export const dynamic = "force-dynamic";

export default async function Playbooks({ searchParams }: { searchParams: Promise<{ error?: string; edit?: string }> }) {
  const { error, edit } = await searchParams;
  const { supabase, team } = await requireMember();
  const [{ data: playbooks }, { data: memories }] = await Promise.all([
    supabase.from("playbooks").select("*").eq("team_id", team.id).order("updated_at", { ascending: false }),
    supabase.from("memories").select("*").eq("team_id", team.id).order("created_at", { ascending: false }).limit(100),
  ]);
  const editing = playbooks?.find((p) => p.id === edit);

  return (
    <>
      <PageHeader title="Playbooks" description="Named processes your teammate follows. It picks the relevant ones for each task. You can also teach it in Slack: “remember how we do X: …”." />
      {error && <Notice kind="error">{error === "missing" ? "Give the playbook a name and some steps." : error}</Notice>}

      <section className="card mb-10">
        <h2 className="font-semibold">{editing ? `Edit “${editing.name}”` : "New playbook"}</h2>
        <form action={savePlaybook} className="mt-4 space-y-4">
          {editing && <input type="hidden" name="id" value={editing.id} />}
          <div>
            <label className="label" htmlFor="name">Name</label>
            <input id="name" name="name" required defaultValue={editing?.name} placeholder="Weekly pipeline summary" className="input" />
          </div>
          <div>
            <label className="label" htmlFor="content">Steps</label>
            <textarea id="content" name="content" rows={8} defaultValue={editing?.content}
              placeholder={"1. Pull open deals from HubSpot closing this month\n2. Group by owner, show amount and stage\n3. Post to #sales with the top 3 risks"} className="input font-mono" />
          </div>
          <div>
            <label className="label" htmlFor="file">…or upload a doc (.txt, .md)</label>
            <input id="file" name="file" type="file" accept=".txt,.md,.markdown,.csv,text/plain,text/markdown" className="text-sm" />
          </div>
          <div className="flex gap-3">
            <button className="btn-primary">Save playbook</button>
            {editing && <a href="/dashboard/playbooks" className="btn-ghost">Cancel</a>}
          </div>
        </form>
      </section>

      <section className="mb-14">
        {playbooks?.length ? (
          <ul className="space-y-3">
            {playbooks.map((p) => (
              <li key={p.id} className="card">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <h3 className="font-medium">{p.name}</h3>
                    <p className="muted mt-1">Updated {timeAgo(p.updated_at)}{p.created_by ? ` · by ${p.created_by.startsWith("U") ? "Slack" : p.created_by.replace("dashboard:", "")}` : ""}</p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <a href={`/dashboard/playbooks?edit=${p.id}`} className="btn-ghost">Edit</a>
                    <form action={deletePlaybook}><input type="hidden" name="id" value={p.id} /><button className="btn-danger">Delete</button></form>
                  </div>
                </div>
                <pre className="mt-4 max-h-40 overflow-auto whitespace-pre-wrap text-sm text-neutral-600">{p.content}</pre>
              </li>
            ))}
          </ul>
        ) : (
          <Empty>No playbooks yet.</Empty>
        )}
      </section>

      <h2 className="mb-2 font-semibold">Team facts</h2>
      <p className="muted mb-4">Short things it should always know. Say “remember that…” in Slack to add one.</p>
      <form action={addMemory} className="mb-6 flex gap-3">
        <input name="fact" placeholder="Our fiscal year starts in April" className="input" />
        <button className="btn-ghost">Add</button>
      </form>
      {memories?.length ? (
        <ul className="divide-y divide-neutral-100 rounded-xl border border-neutral-200">
          {memories.map((m) => (
            <li key={m.id} className="flex items-center justify-between gap-4 px-5 py-3">
              <span>{m.fact}</span>
              <form action={deleteMemory}><input type="hidden" name="id" value={m.id} /><button className="muted hover:text-red-700">Remove</button></form>
            </li>
          ))}
        </ul>
      ) : (
        <Empty>No facts saved yet.</Empty>
      )}
    </>
  );
}
