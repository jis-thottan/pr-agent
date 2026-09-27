"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { api } from "@/lib/api";
import { can, type Permission, type Role } from "@/lib/permissions";

const LINKS: { href: string; label: string; perm?: Permission }[] = [
  { href: "/", label: "Inbox" },
  { href: "/repos", label: "Repositories" },
  { href: "/dashboard", label: "Dashboard", perm: "dashboard" },
  { href: "/audit", label: "Audit log", perm: "audit" },
  { href: "/settings", label: "Settings" },
];

export function NavLinks({ role }: { role: Role }) {
  const path = usePathname();
  return (
    <nav className="flex items-center gap-1 text-sm">
      {LINKS.filter((l) => !l.perm || can(role, l.perm)).map((l) => {
        const active = l.href === "/" ? path === "/" : path.startsWith(l.href) || (l.href === "/repos" && path.startsWith("/c/"));
        return (
          <Link key={l.href} href={l.href} className={clsx("rounded-md px-2.5 py-1", active ? "bg-panel-2 font-medium text-fg" : "text-muted hover:text-fg")}>
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function SignOutButton() {
  return (
    <button
      className="rounded-md px-2 py-1 text-muted hover:bg-panel-2 hover:text-fg"
      onClick={async () => {
        await api("/api/auth/logout", { method: "POST" });
        window.location.href = "/login";
      }}
    >
      Sign out
    </button>
  );
}
