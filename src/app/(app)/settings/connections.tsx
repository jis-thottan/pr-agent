"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { useApi, type Connection } from "@/lib/hooks";
import { Badge, Button, Card, Empty, ErrorNote, Field, Input, Modal, Select, Spinner, timeAgo } from "@/components/ui";

export function ConnectionsSection() {
  const { data, loading, error, reload } = useApi<{ connections: Connection[] }>("/api/connections");
  const [open, setOpen] = useState(false);

  return (
    <Card
      title="Code host connections"
      actions={<Button size="sm" variant="primary" onClick={() => setOpen(true)}>Add connection</Button>}
    >
      <ErrorNote error={error} />
      {loading && !data ? (
        <div className="p-6 text-center"><Spinner /></div>
      ) : !data?.connections.length ? (
        <Empty title="No connections yet">Add a GitHub personal access token to browse repositories and review pull requests. You can add several accounts.</Empty>
      ) : (
        <ul className="divide-y divide-border">
          {data.connections.map((c) => (
            <li key={c.id} className="flex items-center gap-3 px-4 py-3">
              <Badge tone="muted">{c.provider === "github" ? "GitHub" : "Azure DevOps"}</Badge>
              <div className="min-w-0 flex-1">
                <div className="font-medium">{c.name}</div>
                <div className="truncate text-xs text-muted">
                  @{c.accountLogin} · {c.baseUrl} · added {timeAgo(c.createdAt)}
                </div>
              </div>
              <Button
                size="sm"
                variant="danger"
                onClick={async () => {
                  if (!confirm(`Remove connection "${c.name}"? Reviews made through it will also be deleted.`)) return;
                  await api(`/api/connections/${c.id}`, { method: "DELETE" });
                  reload();
                }}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
      <AddConnection open={open} onClose={() => setOpen(false)} onAdded={() => { setOpen(false); reload(); }} />
    </Card>
  );
}

function AddConnection({ open, onClose, onAdded }: { open: boolean; onClose: () => void; onAdded: () => void }) {
  const [provider, setProvider] = useState("github");
  const [enterprise, setEnterprise] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    setBusy(true);
    setError(null);
    try {
      await api("/api/connections", { body: { provider: "github", name: f.name, token: f.token, baseUrl: enterprise ? f.baseUrl : "" } });
      onAdded();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Add code host connection">
      <form id="add-conn" onSubmit={submit} className="space-y-4">
        <Field label="Provider">
          <Select value={provider} onChange={(e) => setProvider(e.target.value)}>
            <option value="github">GitHub</option>
            <option value="azure_devops" disabled>Azure DevOps (Phase 2)</option>
          </Select>
        </Field>
        <Field label="Display name">
          <Input name="name" required placeholder="e.g. Work GitHub" />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={enterprise} onChange={(e) => setEnterprise(e.target.checked)} /> GitHub Enterprise Server
        </label>
        {enterprise && (
          <Field label="API base URL" hint="Usually https://github.your-company.com/api/v3">
            <Input name="baseUrl" type="url" required placeholder="https://github.example.com/api/v3" />
          </Field>
        )}
        <Field
          label="Personal access token"
          hint={<>Fine-grained token with <b>Pull requests: read & write</b>, <b>Contents: read</b> and <b>Metadata: read</b> on the repos you review (or a classic token with <code>repo</code>). Stored encrypted.</>}
        >
          <Input name="token" type="password" required autoComplete="off" placeholder="github_pat_…" />
        </Field>
        <ErrorNote error={error} />
      </form>
      <div className="mt-4 flex justify-end gap-2">
        <Button type="button" onClick={onClose}>Cancel</Button>
        <Button type="submit" form="add-conn" variant="primary" loading={busy}>Verify & save</Button>
      </div>
    </Modal>
  );
}
