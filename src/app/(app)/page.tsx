"use client";

import Link from "next/link";
import { useApi, type AiProviderInfo, type Connection } from "@/lib/hooks";
import { Badge, Button, Card, Empty, ErrorNote, Spinner, timeAgo } from "@/components/ui";
import { PrRow, prHref, type PullSummary } from "@/components/pr-row";

export default function InboxPage() {
  const conns = useApi<{ connections: Connection[] }>("/api/connections");
  const providers = useApi<{ providers: AiProviderInfo[] }>("/api/ai-providers");

  if (conns.loading && !conns.data) return <div className="p-10 text-center"><Spinner /></div>;
  const noConn = !conns.data?.connections.length;
  const noAi = providers.data && !providers.data.providers.length;

  return (
    <main className="mx-auto w-full max-w-5xl space-y-6 p-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-xl font-semibold">Inbox</h1>
          <p className="text-sm text-muted">Pull requests waiting for your review, across all connected accounts.</p>
        </div>
        <Link href="/repos"><Button>Browse repositories</Button></Link>
      </div>
      <ErrorNote error={conns.error} />

      {(noConn || noAi) && (
        <Card title="Get started">
          <ol className="space-y-3 p-4 text-sm">
            <Step done={!noAi} n={1} title="Add an AI provider">
              A local model (Ollama, LM Studio, vLLM), any OpenAI-compatible endpoint, or Anthropic, Gemini or Azure OpenAI. Admins do this in <Link className="text-accent" href="/settings">Settings</Link>.
            </Step>
            <Step done={!noConn} n={2} title="Connect GitHub or Azure DevOps">
              Add a personal access token in <Link className="text-accent" href="/settings">Settings</Link>. Add more than one if you work across accounts, organizations or Enterprise servers.
            </Step>
            <Step done={false} n={3} title="Open a pull request and run the AI review">
              Then accept, edit or dismiss each finding and post the review back to the PR.
            </Step>
          </ol>
        </Card>
      )}

      <AutoDrafts />
      {conns.data?.connections.map((c) => <ConnectionInbox key={c.id} conn={c} />)}
    </main>
  );
}

function Step({ n, title, done, children }: { n: number; title: string; done: boolean; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs ${done ? "border-ok bg-ok text-white" : "border-border"}`}>{done ? "✓" : n}</span>
      <div>
        <div className="font-medium">{title}</div>
        <div className="text-muted">{children}</div>
      </div>
    </li>
  );
}

function ConnectionInbox({ conn }: { conn: Connection }) {
  const { data, loading, error, reload } = useApi<{ pulls: PullSummary[] }>(`/api/c/${conn.id}/inbox`);
  return (
    <Card
      title={<>Review requested · <span className="font-normal text-muted">{conn.name} (@{conn.accountLogin})</span></>}
      actions={<Button size="sm" variant="ghost" onClick={() => reload()} loading={loading}>Refresh</Button>}
    >
      <ErrorNote error={error} />
      {loading && !data ? (
        <div className="p-6 text-center"><Spinner /></div>
      ) : !data?.pulls.length ? (
        <Empty title="Nothing waiting for you">No open pull requests request your review. Browse a repository to review any PR.</Empty>
      ) : (
        <ul className="divide-y divide-border">
          {data.pulls.map((p) => <PrRow key={`${p.owner}/${p.repo}#${p.number}`} connId={conn.id} pr={p} showRepo />)}
        </ul>
      )}
    </Card>
  );
}

type AutoDraft = {
  id: string;
  connectionId: string;
  owner: string;
  repo: string;
  prNumber: number;
  status: "queued" | "running" | "completed" | "failed";
  verdict: "approve" | "comment" | "request_changes" | null;
  riskLevel: "low" | "medium" | "high" | null;
  model: string;
  error: string | null;
  costUsd: number;
  baseReviewId: string | null;
  createdAt: string;
  postedAt: string | null;
  counts: Partial<Record<"critical" | "major" | "minor" | "nit", number>>;
};

/** Draft reviews started by webhooks; hidden until automatic reviews are set up. */
function AutoDrafts() {
  const { data, loading, reload } = useApi<{ reviews: AutoDraft[] }>("/api/auto-reviews/recent");
  if (!data?.reviews.length) return null;
  return (
    <Card title="Automatic draft reviews" actions={<Button size="sm" variant="ghost" onClick={() => reload()} loading={loading}>Refresh</Button>}>
      <ul className="divide-y divide-border">
        {data.reviews.map((r) => (
          <li key={r.id}>
            <Link href={prHref(r.connectionId, { owner: r.owner, repo: r.repo, number: r.prNumber })} className="flex items-center gap-3 px-4 py-2.5 hover:bg-panel">
              <div className="min-w-0 flex-1">
                <div className="font-medium"><span className="text-muted">{r.owner}/{r.repo}</span> #{r.prNumber}</div>
                <div className="truncate text-xs text-muted">
                  {r.model} · {timeAgo(r.createdAt)}{r.baseReviewId ? " · incremental" : ""}{r.costUsd > 0 ? ` · $${r.costUsd.toFixed(2)}` : ""}
                  {r.status === "failed" && r.error && <span className="text-danger"> · {r.error}</span>}
                </div>
              </div>
              {(["critical", "major", "minor"] as const).map((s) =>
                r.counts[s] ? <Badge key={s} tone={s === "critical" ? "danger" : s === "major" ? "warn" : "accent"}>{r.counts[s]} {s}</Badge> : null,
              )}
              {r.postedAt ? (
                <Badge tone="ok">posted</Badge>
              ) : r.status === "completed" ? (
                <Badge tone={r.verdict === "request_changes" ? "danger" : r.verdict === "approve" ? "ok" : "muted"}>{r.verdict?.replace("_", " ") ?? "ready"}</Badge>
              ) : (
                <Badge tone={r.status === "failed" ? "danger" : "muted"}>{r.status}</Badge>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
