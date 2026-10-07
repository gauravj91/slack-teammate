import Link from "next/link";
import { PRODUCT_NAME } from "@/lib/config";

export default async function Installed({ searchParams }: { searchParams: Promise<{ team?: string; app?: string }> }) {
  const { team, app } = await searchParams;
  const deepLink = team && app ? `slack://app?team=${team}&id=${app}&tab=home` : "slack://open";
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 text-center">
      <div className="mx-auto mb-6 flex h-12 w-12 items-center justify-center rounded-full bg-accent-soft text-2xl text-accent">✓</div>
      <h1 className="text-2xl font-semibold tracking-tight">{PRODUCT_NAME} is in your workspace</h1>
      <p className="mt-3 text-neutral-600">
        Open its <b>Home</b> tab in Slack for a 3-step setup: connect your tools, teach it, hand off a task.
      </p>
      <div className="mt-8 flex flex-col gap-3">
        <a href={deepLink} className="btn-primary py-3">Open in Slack</a>
        <Link href="/login" className="btn-ghost py-3">Open the dashboard</Link>
      </div>
    </main>
  );
}
