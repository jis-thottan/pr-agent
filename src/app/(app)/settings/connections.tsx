"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { useApi, type Connection } from "@/lib/hooks";
import { HOST_LABEL } from "@/lib/hosts";
import { Badge, Button, Card, Empty, ErrorNote, Field, Input, Modal, Select, Spinner, timeAgo } from "@/components/ui";
import { AppConnectOptions, type CodeHostAppInfo } from "./code-host-apps";

const AUTH_LABEL = { pat: null, github_app: "GitHub App", entra_oauth: "Microsoft sign-in" } as const;

export function ConnectionsSection({ connectError, connected }: { connectError?: string | null; connected?: number | null }) {
  const { data, loading, error, reload } = useApi<{ connections: Connection[] }>("/api/connections");
  const [open, setOpen] = useState(false);

  return (
    <Card
      title="Code host connections"
      actions={<Button size="sm" variant="primary" onClick={() => setOpen(true)}>Add connection</Button>}
    >
      <ErrorNote error={error ?? connectError} />
      {connected != null && connected > 0 && (
        <p className="border-b border-border bg-ok/10 px-4 py-2 text-sm text-ok">Added {connected} connection{connected === 1 ? "" : "s"}.</p>
      )}
      {connected === 0 && <p className="border-b border-border px-4 py-2 text-sm text-muted">Those installations were already connected.</p>}
      {loading && !data ? (
        <div className="p-6 text-center"><Spinner /></div>
      ) : !data?.connections.length ? (
        <Empty title="No connections yet">Add a GitHub or Azure DevOps personal access token to browse repositories and review pull requests. You can add several accounts.</Empty>
      ) : (
        <ul className="divide-y divide-border">
          {data.connections.map((c) => (
            <li key={c.id} className="flex items-center gap-3 px-4 py-3">
              <Badge tone="muted">{HOST_LABEL[c.provider]}</Badge>
              {AUTH_LABEL[c.authType ?? "pat"] && <Badge tone="accent">{AUTH_LABEL[c.authType ?? "pat"]}</Badge>}
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
  const [provider, setProvider] = useState<"github" | "azure_devops">("github");
  const [method, setMethod] = useState<"token" | "app">("token");
  const apps = useApi<{ apps: CodeHostAppInfo[] }>(open ? "/api/code-host-apps" : null);
  const hasApps = Boolean(apps.data?.apps.length);
  const [enterprise, setEnterprise] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    setBusy(true);
    setError(null);
    try {
      const baseUrl = provider === "azure_devops" ? f.baseUrl : enterprise ? f.baseUrl : "";
      await api("/api/connections", { body: { provider, name: f.name, token: f.token, baseUrl } });
      onAdded();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Add code host connection">
      {hasApps && (
        <div className="mb-4 flex rounded-md border border-border text-sm">
          {(["token", "app"] as const).map((m) => (
            <button key={m} type="button" onClick={() => setMethod(m)} className={`flex-1 px-3 py-1.5 first:rounded-l-md last:rounded-r-md ${method === m ? "bg-panel-2 font-medium" : "text-muted hover:text-fg"}`}>
              {m === "token" ? "Personal access token" : "Connect with an app"}
            </button>
          ))}
        </div>
      )}
      {hasApps && method === "app" ? (
        <AppConnectOptions apps={apps.data!.apps} />
      ) : (
      <form id="add-conn" onSubmit={submit} className="space-y-4">
        <Field label="Provider">
          <Select value={provider} onChange={(e) => setProvider(e.target.value as typeof provider)}>
            <option value="github">GitHub</option>
            <option value="azure_devops">Azure DevOps</option>
          </Select>
        </Field>
        <Field label="Display name">
          <Input name="name" required placeholder={provider === "github" ? "e.g. Work GitHub" : "e.g. Contoso Azure DevOps"} />
        </Field>
        {provider === "github" ? (
          <>
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
          </>
        ) : (
          <>
            <Field label="Organization URL" hint={<>For example <code>https://dev.azure.com/contoso</code>. For Azure DevOps Server, use the collection URL, such as <code>https://tfs.example.com/tfs/DefaultCollection</code>.</>}>
              <Input name="baseUrl" type="url" required placeholder="https://dev.azure.com/your-org" />
            </Field>
            <Field
              label="Personal access token"
              hint={<>Scopes: <b>Code: Read & write</b> (read diffs, post comments, vote) and <b>Project and Team: Read</b> (for the inbox). Stored encrypted.</>}
            >
              <Input name="token" type="password" required autoComplete="off" />
            </Field>
          </>
        )}
        <ErrorNote error={error} />
      </form>
      )}
      <div className="mt-4 flex justify-end gap-2">
        <Button type="button" onClick={onClose}>Cancel</Button>
        {!(hasApps && method === "app") && <Button type="submit" form="add-conn" variant="primary" loading={busy}>Verify & save</Button>}
      </div>
    </Modal>
  );
}
