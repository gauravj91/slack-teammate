import Link from "next/link";
import { requireMember } from "@/lib/auth";
import { PRODUCT_NAME } from "@/lib/config";
import { NavLink } from "./NavLink";

const NAV = [
  { href: "/dashboard", label: "Overview" },
  { href: "/dashboard/connections", label: "Connections" },
  { href: "/dashboard/playbooks", label: "Playbooks" },
  { href: "/dashboard/schedules", label: "Schedules" },
  { href: "/dashboard/activity", label: "Activity" },
  { href: "/dashboard/settings", label: "Settings" },
];

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { team, member } = await requireMember();
  return (
    <div className="mx-auto flex min-h-screen max-w-6xl gap-12 px-6 py-10">
      <aside className="hidden w-48 shrink-0 sm:block">
        <Link href="/dashboard" className="block text-lg font-semibold tracking-tight">{PRODUCT_NAME}</Link>
        <p className="muted mt-1 truncate">{team.name}</p>
        <nav className="mt-10 flex flex-col gap-1">
          {NAV.map((n) => (
            <NavLink key={n.href} href={n.href}>{n.label}</NavLink>
          ))}
        </nav>
        <div className="mt-10 border-t border-neutral-100 pt-6">
          <p className="muted truncate">{member.name || member.email}</p>
          <form action="/auth/logout" method="post">
            <button className="muted mt-2 hover:text-neutral-900">Sign out</button>
          </form>
        </div>
      </aside>
      <div className="min-w-0 flex-1">
        <nav className="mb-8 flex gap-4 overflow-x-auto sm:hidden">
          {NAV.map((n) => (
            <NavLink key={n.href} href={n.href}>{n.label}</NavLink>
          ))}
        </nav>
        {children}
      </div>
    </div>
  );
}
