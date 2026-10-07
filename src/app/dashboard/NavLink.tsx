"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  const path = usePathname();
  const active = href === "/dashboard" ? path === href : path.startsWith(href);
  return (
    <Link
      href={href}
      className={`whitespace-nowrap rounded-lg px-3 py-2 text-sm ${active ? "bg-accent-soft font-medium text-accent" : "text-neutral-600 hover:text-neutral-900"}`}
    >
      {children}
    </Link>
  );
}
