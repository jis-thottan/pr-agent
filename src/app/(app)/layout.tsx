import Link from "next/link";
import { requireUser } from "@/server/auth/session";
import { ThemeToggle } from "@/components/theme-toggle";
import { NavLinks, SignOutButton } from "./nav";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-40 flex h-12 shrink-0 items-center gap-4 border-b border-border bg-panel px-4">
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <span className="flex h-6 w-6 items-center justify-center rounded bg-accent font-mono text-sm text-accent-fg">⌥</span>
          PR Review AI
        </Link>
        <NavLinks />
        <div className="ml-auto flex items-center gap-2 text-sm">
          <ThemeToggle />
          <span className="text-muted" title={user.email}>
            {user.name}
            {user.role === "admin" && <span className="ml-1.5 rounded border border-border px-1 text-[11px]">admin</span>}
          </span>
          <SignOutButton />
        </div>
      </header>
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </div>
  );
}
