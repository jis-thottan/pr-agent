"use client";

import Link from "next/link";
import { use, useMemo, useState } from "react";
import clsx from "clsx";
import { useApi } from "@/lib/hooks";
import { Button, Card, Empty, ErrorNote, Input, Spinner } from "@/components/ui";
import { PrRow, type PullSummary } from "@/components/pr-row";

export default function PullListPage({ params }: { params: Promise<{ connId: string; owner: string; repo: string }> }) {
  const { connId, owner, repo } = use(params);
  const [state, setState] = useState<"open" | "closed" | "all">("open");
  const [q, setQ] = useState("");
  const base = `/api/c/${connId}/pulls/${owner}/${repo}/list?state=${state}`;
  const { data, loading, error, reload } = useApi<{ pulls: PullSummary[] }>(base);
  const pulls = useMemo(() => {
    const n = q.toLowerCase().trim();
    const list = data?.pulls ?? [];
    return n ? list.filter((p) => p.title.toLowerCase().includes(n) || p.author.toLowerCase().includes(n) || String(p.number) === n.replace("#", "")) : list;
  }, [data, q]);

  return (
    <main className="mx-auto w-full max-w-5xl space-y-4 p-6">
      <div className="text-sm text-muted">
        <Link href="/repos" className="hover:text-fg">Repositories</Link> / <span className="text-fg">{decodeURIComponent(owner)}/{decodeURIComponent(repo)}</span>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="mr-auto text-xl font-semibold">Pull requests</h1>
        <div className="flex rounded-md border border-border">
          {(["open", "closed", "all"] as const).map((s) => (
            <button key={s} onClick={() => setState(s)} className={clsx("px-3 py-1 text-sm capitalize first:rounded-l-md last:rounded-r-md", state === s ? "bg-panel-2 font-medium" : "text-muted hover:text-fg")}>
              {s}
            </button>
          ))}
        </div>
        <Input className="w-64" placeholder="Filter by title, author, #…" value={q} onChange={(e) => setQ(e.target.value)} />
        <Button variant="ghost" onClick={() => reload()} loading={loading}>Refresh</Button>
      </div>
      <ErrorNote error={error} />
      <Card>
        {loading && !data ? (
          <div className="p-8 text-center"><Spinner /></div>
        ) : !pulls.length ? (
          <Empty title="No pull requests">{q ? "Nothing matches the filter." : `No ${state === "all" ? "" : state} pull requests.`}</Empty>
        ) : (
          <ul className="divide-y divide-border">{pulls.map((p) => <PrRow key={p.number} connId={connId} pr={p} />)}</ul>
        )}
      </Card>
    </main>
  );
}
