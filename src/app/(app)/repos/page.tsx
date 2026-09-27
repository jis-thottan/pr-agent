"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useApi, type Connection } from "@/lib/hooks";
import { Badge, Button, Card, Empty, ErrorNote, Input, Select, Spinner, timeAgo } from "@/components/ui";

type Repo = { owner: string; name: string; fullName: string; private: boolean; description: string | null; updatedAt: string | null; url: string };

export default function ReposPage() {
  const conns = useApi<{ connections: Connection[] }>("/api/connections");
  const [connId, setConnId] = useState<string | null>(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    if (connId || !conns.data?.connections.length) return;
    let saved: string | null = null;
    try {
      saved = localStorage.getItem("repos.conn");
    } catch {}
    const ids = conns.data.connections.map((c) => c.id);
    setConnId(saved && ids.includes(saved) ? saved : ids[0]);
  }, [conns.data, connId]);

  const repos = useApi<{ repos: Repo[] }>(connId ? `/api/c/${connId}/repos` : null);
  const filtered = useMemo(() => {
    const needle = q.toLowerCase().trim();
    const list = repos.data?.repos ?? [];
    return needle ? list.filter((r) => r.fullName.toLowerCase().includes(needle) || r.description?.toLowerCase().includes(needle)) : list;
  }, [repos.data, q]);

  if (conns.loading && !conns.data) return <div className="p-10 text-center"><Spinner /></div>;
  if (!conns.data?.connections.length)
    return (
      <main className="mx-auto max-w-3xl p-6">
        <Empty title="No connections" action={<Link href="/settings"><Button variant="primary">Add a connection</Button></Link>}>
          Connect a GitHub or Azure DevOps account to see the repositories it can access.
        </Empty>
      </main>
    );

  return (
    <main className="mx-auto w-full max-w-5xl space-y-4 p-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="mr-auto text-xl font-semibold">Repositories</h1>
        <Select
          className="w-64"
          value={connId ?? ""}
          onChange={(e) => {
            setConnId(e.target.value);
            try {
              localStorage.setItem("repos.conn", e.target.value);
            } catch {}
          }}
        >
          {conns.data.connections.map((c) => (
            <option key={c.id} value={c.id}>{c.name} (@{c.accountLogin})</option>
          ))}
        </Select>
        <Input className="w-64" placeholder="Filter repositories…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
        <Button variant="ghost" onClick={() => repos.reload("?refresh=1")} loading={repos.loading}>Refresh</Button>
      </div>
      <ErrorNote error={repos.error} />
      <Card>
        {repos.loading && !repos.data ? (
          <div className="p-8 text-center"><Spinner /></div>
        ) : !filtered.length ? (
          <Empty title="No repositories found">{q ? "Try another filter." : "This account can't see any repositories."}</Empty>
        ) : (
          <ul className="divide-y divide-border">
            {filtered.slice(0, 300).map((r) => (
              <li key={r.fullName}>
                <Link href={`/c/${connId}/${encodeURIComponent(r.owner)}/${encodeURIComponent(r.name)}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-panel">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium"><span className="text-muted">{r.owner}/</span>{r.name}</div>
                    {r.description && <div className="truncate text-xs text-muted">{r.description}</div>}
                  </div>
                  {r.private && <Badge tone="muted">private</Badge>}
                  <span className="w-24 text-right text-xs text-muted">{timeAgo(r.updatedAt)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {filtered.length > 300 && <p className="text-center text-xs text-muted">Showing 300 of {filtered.length}. Type to narrow the list.</p>}
    </main>
  );
}
