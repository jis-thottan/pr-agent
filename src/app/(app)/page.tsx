"use client";

import Link from "next/link";
import { useApi, type AiProviderInfo, type Connection } from "@/lib/hooks";
import { Button, Card, Empty, ErrorNote, Spinner } from "@/components/ui";
import { PrRow, type PullSummary } from "@/components/pr-row";

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
              A local model (Ollama, LM Studio, vLLM) or any OpenAI-compatible cloud endpoint. Admins do this in <Link className="text-accent" href="/settings">Settings</Link>.
            </Step>
            <Step done={!noConn} n={2} title="Connect GitHub">
              Add a personal access token in <Link className="text-accent" href="/settings">Settings</Link>. Add more than one if you work across accounts or Enterprise servers.
            </Step>
            <Step done={false} n={3} title="Open a pull request and run the AI review">
              Then accept, edit or dismiss each finding and post the review back to the PR.
            </Step>
          </ol>
        </Card>
      )}

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
