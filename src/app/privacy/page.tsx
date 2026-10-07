import Link from "next/link";
import { PRODUCT_NAME } from "@/lib/config";

export default function Privacy() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <Link href="/" className="text-lg font-semibold tracking-tight">{PRODUCT_NAME}</Link>
      <h1 className="mt-12 text-3xl font-semibold tracking-tight">Privacy note</h1>
      <div className="mt-8 space-y-6 text-neutral-700">
        <p><b>What we store.</b> Your workspace name and id, the bot token Slack gives us (encrypted with AES-256-GCM), playbooks and facts your team teaches it, schedules, task history, and an audit log of every action it takes.</p>
        <p><b>What it reads.</b> Only messages that mention it, direct messages to it, and channels it has been invited to when a task needs them. It cannot read private channels it is not in.</p>
        <p><b>Connected apps.</b> App sign-ins are handled by our integration provider (Composio). Each person connects their own account; we never see passwords, and tokens are stored by the provider, not in our database.</p>
        <p><b>AI processing.</b> Task content is sent to Anthropic&apos;s Claude API to do the work. Anthropic does not train on API data by default.</p>
        <p><b>Isolation.</b> Each workspace&apos;s data is separated with database row-level security.</p>
        <p><b>Deleting.</b> An admin can delete all of the workspace&apos;s data in Dashboard → Settings → Delete all data. This also revokes our Slack token and removes app connections. Uninstalling the app from Slack revokes the token immediately.</p>
      </div>
    </main>
  );
}
