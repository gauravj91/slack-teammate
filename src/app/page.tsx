import Link from "next/link";
import { AddToSlack } from "@/components/AddToSlack";
import { PRODUCT_NAME } from "@/lib/config";

const STEPS = [
  { n: "1", title: "Add to Slack", body: `One click. ${PRODUCT_NAME} joins your workspace with its own name and avatar. No signup form.` },
  { n: "2", title: "Connect your tools", body: "HubSpot, Gmail, Notion, Linear, Sheets and hundreds more. Everyone connects their own account." },
  { n: "3", title: "Teach it how you work", body: 'Say "remember how we do weekly reporting…" or paste a process doc. It follows your playbooks.' },
  { n: "4", title: "Hand off the work", body: "Mention it in any channel, DM it, or schedule it. It asks before changing anything." },
];

const MESSAGES: Record<string, string> = {
  cancelled: "Installation was cancelled.",
  invalid_state: "That install link expired. Please try again.",
  failed: "Installation failed. Please try again.",
  deleted: "All of your workspace's data has been deleted.",
};

export default async function Landing({ searchParams }: { searchParams: Promise<{ install?: string; deleted?: string }> }) {
  const params = await searchParams;
  const install = params.deleted ? "deleted" : params.install;
  return (
    <main className="mx-auto max-w-4xl px-6">
      <nav className="flex items-center justify-between py-8">
        <span className="text-lg font-semibold tracking-tight">{PRODUCT_NAME}</span>
        <Link href="/login" className="muted hover:text-neutral-900">Sign in</Link>
      </nav>

      {install && MESSAGES[install] && (
        <p className="mb-6 rounded-lg bg-accent-soft px-4 py-3 text-sm text-accent">{MESSAGES[install]}</p>
      )}

      <section className="py-20 text-center sm:py-28">
        <p className="mb-4 text-sm font-medium text-accent">Your AI teammate in Slack</p>
        <h1 className="mx-auto max-w-2xl text-4xl font-semibold tracking-tight sm:text-5xl">
          It doesn&apos;t just chat. It does the work.
        </h1>
        <p className="mx-auto mt-6 max-w-xl text-lg text-neutral-600">
          {PRODUCT_NAME} connects to your team&apos;s tools, learns your processes, runs tasks on request or on a schedule,
          and asks before it acts.
        </p>
        <div className="mt-10 flex justify-center">
          <AddToSlack />
        </div>
        <p className="muted mt-4">Free to try · Works in any Slack workspace · Remove any time</p>
      </section>

      <section className="py-16">
        <h2 className="mb-10 text-center text-2xl font-semibold tracking-tight">How it works</h2>
        <ol className="grid gap-6 sm:grid-cols-2">
          {STEPS.map((s) => (
            <li key={s.n} className="card">
              <span className="mb-4 flex h-8 w-8 items-center justify-center rounded-full bg-accent-soft text-sm font-semibold text-accent">{s.n}</span>
              <h3 className="font-semibold">{s.title}</h3>
              <p className="mt-2 text-neutral-600">{s.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="py-16">
        <div className="card bg-neutral-50">
          <h2 className="text-lg font-semibold">Privacy, plainly</h2>
          <ul className="mt-4 space-y-2 text-neutral-600">
            <li>• It only reads channels it&apos;s invited to, plus messages sent to it.</li>
            <li>• App connections are per person and use your own sign-in. We never see your passwords.</li>
            <li>• Every action is logged; changes need approval unless your admin says otherwise.</li>
            <li>• Your data stays isolated to your workspace. Delete everything with one click.</li>
          </ul>
          <Link href="/privacy" className="mt-4 inline-block text-sm text-accent hover:underline">Read the privacy note →</Link>
        </div>
      </section>

      <footer className="muted flex justify-between border-t border-neutral-100 py-10">
        <span>© {new Date().getFullYear()} {PRODUCT_NAME}</span>
        <Link href="/privacy" className="hover:text-neutral-900">Privacy</Link>
      </footer>
    </main>
  );
}
