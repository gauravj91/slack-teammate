export function PageHeader({ title, description, children }: { title: string; description?: string; children?: React.ReactNode }) {
  return (
    <header className="mb-10 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-2 max-w-xl text-neutral-600">{description}</p>}
      </div>
      {children}
    </header>
  );
}

export function Notice({ kind = "info", children }: { kind?: "info" | "error"; children: React.ReactNode }) {
  return (
    <p className={`mb-6 rounded-lg px-4 py-3 text-sm ${kind === "error" ? "bg-red-50 text-red-700" : "bg-accent-soft text-accent"}`}>{children}</p>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-xl border border-dashed border-neutral-200 px-6 py-10 text-center text-neutral-500">{children}</p>;
}

export function StatusPill({ status }: { status: string }) {
  const tone: Record<string, string> = {
    ok: "bg-emerald-50 text-emerald-700",
    done: "bg-emerald-50 text-emerald-700",
    approved: "bg-emerald-50 text-emerald-700",
    error: "bg-red-50 text-red-700",
    failed: "bg-red-50 text-red-700",
    rejected: "bg-red-50 text-red-700",
    awaiting_approval: "bg-amber-50 text-amber-700",
    running: "bg-accent-soft text-accent",
    queued: "bg-neutral-100 text-neutral-600",
  };
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${tone[status] ?? "bg-neutral-100 text-neutral-600"}`}>{status.replace("_", " ")}</span>;
}

export function timeAgo(iso: string): string {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

export function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 86400_000).toISOString();
}
