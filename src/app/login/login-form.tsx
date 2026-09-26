"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { Button, ErrorNote, Field, Input } from "@/components/ui";

export function LoginForm({ firstRun, allowRegistration }: { firstRun: boolean; allowRegistration: boolean }) {
  const [mode, setMode] = useState<"login" | "register">(firstRun ? "register" : "login");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    setBusy(true);
    setError(null);
    try {
      await api(`/api/auth/${mode}`, { body: form });
      window.location.href = "/";
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-panel p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-accent font-mono text-lg font-bold text-accent-fg">⌥</div>
          <h1 className="text-xl font-semibold">PR Review AI</h1>
          <p className="mt-1 text-sm text-muted">
            {firstRun ? "Create the first admin account to get started." : mode === "login" ? "Sign in to review pull requests." : "Create your account."}
          </p>
        </div>
        <form onSubmit={submit} className="space-y-4 rounded-lg border border-border bg-bg p-5">
          {mode === "register" && (
            <Field label="Name">
              <Input name="name" required autoComplete="name" />
            </Field>
          )}
          <Field label="Email">
            <Input name="email" type="email" required autoComplete="email" autoFocus />
          </Field>
          <Field label="Password" hint={mode === "register" ? "At least 10 characters." : undefined}>
            <Input name="password" type="password" required minLength={mode === "register" ? 10 : undefined} autoComplete={mode === "login" ? "current-password" : "new-password"} />
          </Field>
          <ErrorNote error={error} />
          <Button type="submit" variant="primary" className="w-full" loading={busy}>
            {mode === "login" ? "Sign in" : firstRun ? "Create admin account" : "Create account"}
          </Button>
        </form>
        {!firstRun && allowRegistration && (
          <p className="mt-4 text-center text-sm text-muted">
            {mode === "login" ? "No account? " : "Have an account? "}
            <button className="text-accent hover:underline" onClick={() => setMode(mode === "login" ? "register" : "login")}>
              {mode === "login" ? "Register" : "Sign in"}
            </button>
          </p>
        )}
      </div>
    </main>
  );
}
