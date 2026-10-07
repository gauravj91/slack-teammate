import { requireMember } from "@/lib/auth";
import { composioEnabled, composioUserId, listConnectedApps } from "@/lib/agent/composio";
import { connectApp } from "../actions";
import { Empty, Notice, PageHeader } from "../ui";

export const dynamic = "force-dynamic";

const POPULAR = ["hubspot", "gmail", "googlecalendar", "googlesheets", "googledrive", "notion", "linear", "jira", "github", "salesforce", "asana", "airtable", "zendesk", "intercom", "stripe"];

export default async function Connections({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const { team, member } = await requireMember();
  const apps = await listConnectedApps(composioUserId(team.id, member.slack_user_id)).catch(() => []);

  return (
    <>
      <PageHeader title="Connections" description="Apps are connected per person, with your own sign-in. Your teammates connect theirs from Slack or here." />
      {!composioEnabled() && <Notice kind="error">App connections are off: set COMPOSIO_API_KEY in your environment.</Notice>}
      {error && <Notice kind="error">Couldn&apos;t create a connect link. Check the app name and try again.</Notice>}

      <section className="card mb-10">
        <h2 className="font-semibold">Connect an app</h2>
        <form action={connectApp} className="mt-4 flex flex-wrap items-end gap-3">
          <div className="min-w-48 flex-1">
            <label className="label" htmlFor="app">Popular</label>
            <select id="app" name="app" className="input">
              {POPULAR.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <div className="min-w-48 flex-1">
            <label className="label" htmlFor="other">…or any other app</label>
            <input id="other" name="other" placeholder="e.g. pipedrive" className="input" />
          </div>
          <button className="btn-primary" disabled={!composioEnabled()}>Connect</button>
        </form>
        <p className="muted mt-3">You&apos;ll sign in on the app&apos;s own page and come straight back. In Slack, just say “connect HubSpot”.</p>
      </section>

      <h2 className="mb-4 font-semibold">Your connected apps</h2>
      {apps.length ? (
        <ul className="grid gap-3 sm:grid-cols-2">
          {apps.map((a) => (
            <li key={a.slug} className="card flex items-center gap-3 py-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {a.logo && <img src={a.logo} alt="" className="h-6 w-6" />}
              <span className="font-medium">{a.name}</span>
              <span className="muted ml-auto">{a.slug}</span>
            </li>
          ))}
        </ul>
      ) : (
        <Empty>Nothing connected yet.</Empty>
      )}
    </>
  );
}
