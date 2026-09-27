"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Button, Card, Empty, ErrorNote, Input, Select, Spinner, timeAgo } from "@/components/ui";

type Entry = { id: string; action: string; details: Record<string, unknown>; createdAt: string; userId: string | null; userName: string | null; userEmail: string | null };
type Page = { entries: Entry[]; next: string | null; actions: string[] };

const GROUPS = ["user.", "review.", "connection.", "ai_provider.", "auto_review.", "review_profile.", "sso.", "code_host_app.", "budget."];

export function AuditView() {
  const [action, setAction] = useState("");
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [actions, setActions] = useState<string[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async (before?: string) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (action) params.set("action", action);
      if (query) params.set("q", query);
      if (before) params.set("before", before);
      const page = await api<Page>(`/api/audit?${params}`);
      setEntries((cur) => (before ? [...cur, ...page.entries] : page.entries));
      setNext(page.next);
      setActions(page.actions);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [action, query]); // eslint-disable-line react-hooks/exhaustive-deps

  const groups = GROUPS.filter((g) => actions.some((a) => a.startsWith(g)));

  return (
    <main className="mx-auto w-full max-w-6xl space-y-4 p-6">
      <div className="flex flex-wrap items-center gap-3">
        <div className="mr-auto">
          <h1 className="text-xl font-semibold">Audit log</h1>
          <p className="text-sm text-muted">Sign-ins, settings changes, started and posted reviews. Newest first.</p>
        </div>
        <Select className="w-56" value={action} onChange={(e) => setAction(e.target.value)} aria-label="Action">
          <option value="">All actions</option>
          {groups.map((g) => <option key={g} value={g}>All {g.slice(0, -1).replace("_", " ")}</option>)}
          {actions.map((a) => <option key={a} value={a}>{a}</option>)}
        </Select>
        <form onSubmit={(e) => { e.preventDefault(); setQuery(q.trim()); }} className="flex gap-2">
          <Input className="w-64" placeholder="Search details or email…" value={q} onChange={(e) => setQ(e.target.value)} />
          <Button type="submit">Search</Button>
        </form>
      </div>
      <ErrorNote error={error} />
      <Card>
        {loading && !entries.length ? (
          <div className="p-8 text-center"><Spinner /></div>
        ) : !entries.length ? (
          <Empty title="No matching entries" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border text-xs text-muted">
                <tr><th className="px-4 py-2 text-left font-medium">When</th><th className="px-2 py-2 text-left font-medium">Who</th><th className="px-2 py-2 text-left font-medium">Action</th><th className="px-4 py-2 text-left font-medium">Details</th></tr>
              </thead>
              <tbody className="divide-y divide-border align-top">
                {entries.map((e) => (
                  <tr key={e.id}>
                    <td className="whitespace-nowrap px-4 py-2 text-xs text-muted" title={new Date(e.createdAt).toLocaleString()}>{timeAgo(e.createdAt)}</td>
                    <td className="px-2 py-2">{e.userName ? <>{e.userName}<div className="text-xs text-muted">{e.userEmail}</div></> : <span className="text-muted">system</span>}</td>
                    <td className="whitespace-nowrap px-2 py-2 font-mono text-xs">{e.action}</td>
                    <td className="px-4 py-2"><Details details={e.details} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {next && <div className="text-center"><Button onClick={() => void load(next)} loading={loading}>Load older entries</Button></div>}
    </main>
  );
}

function Details({ details }: { details: Record<string, unknown> }) {
  const entries = Object.entries(details ?? {});
  if (!entries.length) return <span className="text-muted">–</span>;
  const short = entries.slice(0, 4);
  return (
    <details className="text-xs">
      <summary className="cursor-pointer list-none">
        {short.map(([k, v]) => (
          <span key={k} className="mr-3 inline-block max-w-72 truncate align-bottom"><span className="text-muted">{k}:</span> {typeof v === "object" ? JSON.stringify(v) : String(v)}</span>
        ))}
        {entries.length > short.length && <span className="text-accent">+{entries.length - short.length} more</span>}
      </summary>
      <pre className="mt-1 max-w-2xl overflow-x-auto rounded bg-panel p-2 font-mono text-[11px]">{JSON.stringify(details, null, 2)}</pre>
    </details>
  );
}
