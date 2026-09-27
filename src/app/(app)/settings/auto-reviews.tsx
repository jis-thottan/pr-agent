"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { HOST_LABEL, type HostType } from "@/lib/hosts";
import { useApi, type AiProviderInfo, type Connection, type ReviewProfileInfo } from "@/lib/hooks";
import { Badge, Button, Card, Empty, ErrorNote, Field, Input, Modal, Select, Spinner, timeAgo } from "@/components/ui";

type Rule = {
  id: string;
  connectionId: string;
  connectionName: string;
  host: HostType;
  owner: string;
  repo: string;
  providerId: string | null;
  profileId: string | null;
  enabled: boolean;
  onOpen: boolean;
  onPush: boolean;
  skipDrafts: boolean;
  incremental: boolean;
  lastDeliveryAt: string | null;
  lastError: string | null;
  webhookUrl: string;
};

type Settings = Pick<Rule, "providerId" | "profileId" | "enabled" | "onOpen" | "onPush" | "skipDrafts" | "incremental">;

export function AutoReviewsSection() {
  const { data, loading, error, reload } = useApi<{ rules: Rule[]; publicUrlSet: boolean }>("/api/auto-reviews");
  const [adding, setAdding] = useState(false);
  const [setup, setSetup] = useState<{ rule: Pick<Rule, "id" | "host" | "owner" | "repo" | "webhookUrl">; secret: string | null } | null>(null);

  const settingsOf = (r: Rule): Settings => ({
    providerId: r.providerId,
    profileId: r.profileId,
    enabled: r.enabled,
    onOpen: r.onOpen,
    onPush: r.onPush,
    skipDrafts: r.skipDrafts,
    incremental: r.incremental,
  });

  return (
    <Card title="Automatic reviews" actions={<Button size="sm" variant="primary" onClick={() => setAdding(true)}>Add repository</Button>}>
      <ErrorNote error={error} />
      {loading && !data ? (
        <div className="p-6 text-center"><Spinner /></div>
      ) : !data?.rules.length ? (
        <Empty title="No automatic reviews">
          Add a webhook to a repository and the AI drafts a review whenever a pull request is opened or updated. Drafts wait for you in the Inbox; nothing is posted until you submit it.
        </Empty>
      ) : (
        <ul className="divide-y divide-border">
          {data.rules.map((r) => (
            <li key={r.id} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 font-medium">
                  <span><span className="text-muted">{r.owner}/</span>{r.repo}</span>
                  <Badge tone="muted">{HOST_LABEL[r.host]} · {r.connectionName}</Badge>
                  {!r.enabled && <Badge tone="warn">paused</Badge>}
                  {r.incremental && <Badge tone="muted">incremental</Badge>}
                </div>
                <div className="truncate text-xs text-muted">
                  {[r.onOpen && "new PRs", r.onPush && "new commits"].filter(Boolean).join(" and ") || "no triggers"}
                  {r.skipDrafts && " · drafts skipped"} · {r.lastDeliveryAt ? `last delivery ${timeAgo(r.lastDeliveryAt)}` : "no deliveries yet"}
                </div>
                {r.lastError && <div className="truncate text-xs text-danger" title={r.lastError}>Last run failed: {r.lastError}</div>}
              </div>
              <Button size="sm" onClick={() => setSetup({ rule: r, secret: null })}>Webhook setup</Button>
              <Button
                size="sm"
                onClick={async () => {
                  await api(`/api/auto-reviews/${r.id}`, { method: "PATCH", body: { ...settingsOf(r), enabled: !r.enabled } });
                  reload();
                }}
              >
                {r.enabled ? "Pause" : "Resume"}
              </Button>
              <Button
                size="sm"
                variant="danger"
                onClick={async () => {
                  if (!confirm(`Stop automatic reviews for ${r.owner}/${r.repo}? Remove the webhook on the code host too.`)) return;
                  await api(`/api/auto-reviews/${r.id}`, { method: "DELETE" });
                  reload();
                }}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
      {adding && (
        <AddRule
          onClose={() => setAdding(false)}
          onCreated={(rule, secret) => {
            setAdding(false);
            reload();
            setSetup({ rule, secret });
          }}
        />
      )}
      {setup && <SetupModal {...setup} publicUrlSet={data?.publicUrlSet ?? false} onClose={() => setSetup(null)} />}
    </Card>
  );
}

function AddRule({ onClose, onCreated }: { onClose: () => void; onCreated: (rule: Pick<Rule, "id" | "host" | "owner" | "repo" | "webhookUrl">, secret: string) => void }) {
  const conns = useApi<{ connections: Connection[] }>("/api/connections");
  const providers = useApi<{ providers: AiProviderInfo[] }>("/api/ai-providers");
  const profiles = useApi<{ profiles: ReviewProfileInfo[] }>("/api/profiles");
  const [connectionId, setConnectionId] = useState("");
  const conn = conns.data?.connections.find((c) => c.id === (connectionId || conns.data?.connections[0]?.id));
  const repos = useApi<{ repos: { owner: string; name: string; fullName: string }[] }>(conn ? `/api/c/${conn.id}/repos` : null);
  const [repo, setRepo] = useState("");
  const [s, setS] = useState<Settings>({ providerId: null, profileId: null, enabled: true, onOpen: true, onPush: true, skipDrafts: true, incremental: true });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setS((x) => ({ ...x, [k]: v }));

  const save = async () => {
    if (!conn) return;
    const match = repos.data?.repos.find((r) => r.fullName.toLowerCase() === repo.trim().toLowerCase());
    const [owner, ...rest] = repo.trim().split("/");
    const target = match ? { owner: match.owner, repo: match.name } : { owner, repo: rest.join("/") };
    if (!target.owner || !target.repo) return setError("Pick a repository from the list, or type owner/repository.");
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ id: string; secret: string; webhookUrl: string }>("/api/auto-reviews", { body: { ...s, connectionId: conn.id, ...target } });
      onCreated({ id: res.id, host: conn.provider, webhookUrl: res.webhookUrl, ...target }, res.secret);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open wide onClose={onClose} title="Automatic reviews for a repository" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save} loading={busy} disabled={!conn || !repo.trim()}>Create webhook</Button></>}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Connection" hint="Reviews run with this account's access">
          <Select value={conn?.id ?? ""} onChange={(e) => { setConnectionId(e.target.value); setRepo(""); }}>
            {conns.data?.connections.map((c) => <option key={c.id} value={c.id}>{c.name} ({HOST_LABEL[c.provider]})</option>)}
          </Select>
        </Field>
        <Field label="Repository" hint={repos.loading ? "Loading repositories…" : "Start typing to search"}>
          <Input value={repo} onChange={(e) => setRepo(e.target.value)} list="auto-review-repos" placeholder="owner/repository" className="font-mono" />
          <datalist id="auto-review-repos">{repos.data?.repos.map((r) => <option key={r.fullName} value={r.fullName} />)}</datalist>
        </Field>
        <Field label="Review profile" hint="Instructions, files to skip and severity threshold">
          <Select value={s.profileId ?? ""} onChange={(e) => set("profileId", e.target.value || null)}>
            <option value="">None</option>
            {profiles.data?.profiles.map((p) => <option key={p.id} value={p.id}>{p.name}{p.shared ? " (shared)" : ""}</option>)}
          </Select>
        </Field>
        <Field label="Model">
          <Select value={s.providerId ?? ""} onChange={(e) => set("providerId", e.target.value || null)}>
            <option value="">The profile&apos;s model, or the default provider</option>
            {providers.data?.providers.map((p) => <option key={p.id} value={p.id}>{p.name}: {p.model}</option>)}
          </Select>
        </Field>
        <div className="space-y-2 text-sm sm:col-span-2">
          <label className="flex items-center gap-2"><input type="checkbox" checked={s.onOpen} onChange={(e) => set("onOpen", e.target.checked)} /> Review new pull requests (opened, reopened, marked ready)</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={s.onPush} onChange={(e) => set("onPush", e.target.checked)} /> Review again when new commits are pushed</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={s.incremental} onChange={(e) => set("incremental", e.target.checked)} /> On new commits, only review files that changed since the last review</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={s.skipDrafts} onChange={(e) => set("skipDrafts", e.target.checked)} /> Skip draft pull requests</label>
        </div>
      </div>
      <div className="mt-4"><ErrorNote error={error} /></div>
    </Modal>
  );
}

function SetupModal({ rule, secret: initialSecret, publicUrlSet, onClose }: {
  rule: Pick<Rule, "id" | "host" | "owner" | "repo" | "webhookUrl">;
  secret: string | null;
  publicUrlSet: boolean;
  onClose: () => void;
}) {
  const [secret, setSecret] = useState(initialSecret);
  const [busy, setBusy] = useState(false);
  const reveal = async (rotate = false) => {
    if (rotate && !confirm("Create a new secret? The webhook stops working until you update it on the code host.")) return;
    setBusy(true);
    try {
      const r = await api<{ secret: string }>(`/api/auto-reviews/${rule.id}/secret`, rotate ? { method: "POST", body: {} } : {});
      setSecret(r.secret);
    } finally {
      setBusy(false);
    }
  };
  const Copy = ({ value }: { value: string }) => (
    <div className="flex gap-2">
      <Input readOnly value={value} className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
      <Button size="sm" onClick={() => void navigator.clipboard?.writeText(value)}>Copy</Button>
    </div>
  );

  return (
    <Modal open wide onClose={onClose} title={`Webhook for ${rule.owner}/${rule.repo}`} footer={<Button variant="primary" onClick={onClose}>Done</Button>}>
      <div className="space-y-4 text-sm">
        <Field label="Webhook URL"><Copy value={rule.webhookUrl} /></Field>
        {!publicUrlSet && (
          <p className="rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">
            This URL uses the address you opened the app on. If the code host reaches the app at a different address, set <code>PUBLIC_URL</code> and reopen this dialog.
          </p>
        )}
        <Field label="Secret">
          {secret ? <Copy value={secret} /> : <Button size="sm" onClick={() => void reveal()} loading={busy}>Show secret</Button>}
        </Field>
        {rule.host === "github" ? (
          <ol className="list-inside list-decimal space-y-1 text-muted">
            <li>In the repository on GitHub, open <b>Settings → Webhooks → Add webhook</b>.</li>
            <li>Paste the <b>Payload URL</b> and set <b>Content type</b> to <code>application/json</code>.</li>
            <li>Paste the <b>Secret</b>.</li>
            <li>Choose <b>Let me select individual events</b> and tick only <b>Pull requests</b>.</li>
            <li>Save. GitHub sends a ping, and the <b>Recent Deliveries</b> tab should show a 200 response.</li>
          </ol>
        ) : (
          <ol className="list-inside list-decimal space-y-1 text-muted">
            <li>In Azure DevOps, open <b>Project settings → Service hooks → Create subscription → Web Hooks</b>.</li>
            <li>Trigger: <b>Pull request created</b>, and set <b>Repository</b> to <code>{rule.repo}</code>.</li>
            <li>Action: paste the <b>URL</b>. Under <b>Basic authentication</b>, enter any username and paste the <b>Secret</b> as the password. Keep <b>Resource details to send</b> at <b>All</b>.</li>
            <li>Create a second subscription with trigger <b>Pull request updated</b>, the same repository, and <b>Change</b> set to <b>Source branch updated</b>.</li>
            <li>Click <b>Test</b>. A 202 response means the secret matched.</li>
          </ol>
        )}
        <p className="text-xs text-muted">
          Each head commit is reviewed once, even if the host sends several events. Draft reviews show up in the Inbox; nothing is posted to the pull request until you submit it.
        </p>
        {secret && <Button size="sm" variant="ghost" onClick={() => void reveal(true)} loading={busy}>Rotate secret</Button>}
      </div>
    </Modal>
  );
}
