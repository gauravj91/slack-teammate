import { requireMember } from "@/lib/auth";
import { AUTONOMY_LABELS } from "@/lib/agent/approval";
import { DEFAULT_MODEL, MODEL_CHOICES } from "@/lib/config";
import { getBotToken, type Autonomy } from "@/lib/db";
import { slackCall } from "@/lib/slack/api";
import { deleteAllData, updateSettings } from "../actions";
import { Notice, PageHeader } from "../ui";

export const dynamic = "force-dynamic";

interface SlackUser { id: string; name: string; real_name?: string; deleted?: boolean; is_bot?: boolean; profile?: { real_name?: string } }

async function workspaceUsers(teamId: string): Promise<SlackUser[]> {
  const token = await getBotToken(teamId);
  if (!token) return [];
  try {
    const res = await slackCall<{ ok: boolean; members: SlackUser[] }>("users.list", token, { limit: 500 });
    return res.members.filter((u) => !u.deleted && !u.is_bot && u.id !== "USLACKBOT");
  } catch {
    return [];
  }
}

const AUTONOMY_HELP: Record<Autonomy, string> = {
  ask_writes: "Reads freely. Before creating, updating, deleting or sending anything it posts Approve / Reject buttons.",
  ask_external: "Makes changes in your tools on its own, but asks before emailing people or posting to other channels.",
  full_auto: "Never asks. Every action is still logged in Activity.",
};

export default async function Settings({ searchParams }: { searchParams: Promise<{ saved?: string; error?: string }> }) {
  const { saved, error } = await searchParams;
  const { team, member } = await requireMember();
  const users = await workspaceUsers(team.id);
  const disabled = !member.is_admin;
  const label = (u: SlackUser) => u.profile?.real_name || u.real_name || u.name;

  return (
    <>
      <PageHeader title="Settings" description={disabled ? "Only workspace admins can change settings." : "Control what your teammate may do and who can use it."} />
      {saved && <Notice>Saved.</Notice>}
      {error && <Notice kind="error">{error === "admin_only" ? "Only admins can do that." : error === "confirm" ? "Type the workspace name exactly to confirm." : error}</Notice>}

      <form action={updateSettings} className="space-y-10">
        <fieldset disabled={disabled} className="card space-y-3">
          <legend className="px-1 font-semibold">Autonomy</legend>
          {(Object.keys(AUTONOMY_LABELS) as Autonomy[]).map((a) => (
            <label key={a} className="flex cursor-pointer gap-3 rounded-lg p-3 hover:bg-neutral-50">
              <input type="radio" name="autonomy" value={a} defaultChecked={team.autonomy === a} className="mt-1 accent-[var(--color-accent)]" />
              <span><span className="font-medium">{AUTONOMY_LABELS[a]}</span><span className="muted block">{AUTONOMY_HELP[a]}</span></span>
            </label>
          ))}
        </fieldset>

        <fieldset disabled={disabled} className="card">
          <legend className="px-1 font-semibold">Who can use it</legend>
          <label className="flex items-center gap-2">
            <input type="checkbox" name="everyone" value="1" defaultChecked={team.allowed_user_ids.length === 0} className="accent-[var(--color-accent)]" />
            Everyone in the workspace
          </label>
          <p className="muted mt-1">Untick to allow only the people selected below. Admins can always use it.</p>
          <div className="mt-4 grid max-h-64 gap-1 overflow-auto sm:grid-cols-2">
            {users.map((u) => (
              <label key={u.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="allowed" value={u.id} defaultChecked={team.allowed_user_ids.includes(u.id)} className="accent-[var(--color-accent)]" />
                {label(u)}
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset disabled={disabled} className="card">
          <legend className="px-1 font-semibold">Admins</legend>
          <p className="muted">Admins change settings, approve anyone&apos;s requests and can delete data. The installer is always an admin.</p>
          <div className="mt-4 grid max-h-64 gap-1 overflow-auto sm:grid-cols-2">
            {users.map((u) => (
              <label key={u.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="admins" value={u.id} defaultChecked={team.admin_user_ids.includes(u.id) || u.id === team.installer_user_id} disabled={u.id === team.installer_user_id} className="accent-[var(--color-accent)]" />
                {label(u)}{u.id === team.installer_user_id && <span className="muted">(installer)</span>}
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset disabled={disabled} className="card grid gap-4 sm:grid-cols-2">
          <legend className="px-1 font-semibold">Model &amp; limits</legend>
          <div>
            <label className="label" htmlFor="model">AI model</label>
            <select id="model" name="model" defaultValue={team.model ?? ""} className="input">
              <option value="">Default ({DEFAULT_MODEL})</option>
              {MODEL_CHOICES.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="timezone">Default timezone</label>
            <input id="timezone" name="timezone" defaultValue={team.timezone} className="input" />
          </div>
          <div>
            <label className="label" htmlFor="max_steps">Max steps per task</label>
            <input id="max_steps" name="max_steps" type="number" min={1} max={30} defaultValue={team.max_steps} className="input" />
          </div>
          <div>
            <label className="label" htmlFor="max_tokens">Max tokens per task</label>
            <input id="max_tokens" name="max_tokens" type="number" min={2000} max={500000} step={1000} defaultValue={team.max_tokens} className="input" />
            <p className="muted mt-1">Caps spend per task. 60,000 tokens ≈ a few cents on the default model.</p>
          </div>
        </fieldset>

        {!disabled && <button className="btn-primary">Save settings</button>}
      </form>

      {!disabled && (
        <section className="card mt-14 border-red-200">
          <h2 className="font-semibold text-red-700">Delete all data</h2>
          <p className="muted mt-2">Removes playbooks, facts, schedules, tasks, the audit log and everyone&apos;s app connections, and revokes the Slack token. This cannot be undone.</p>
          <form action={deleteAllData} className="mt-4 flex flex-wrap gap-3">
            <input name="confirm" placeholder={`Type "${team.name}" to confirm`} className="input max-w-xs" />
            <button className="btn-danger">Delete everything</button>
          </form>
        </section>
      )}
    </>
  );
}
