"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { Badge, Button, Card, Empty, ErrorNote, Field, Input, Modal, Select, Spinner, Textarea } from "@/components/ui";

export type CodeHostAppInfo = {
  id: string;
  kind: "github_app" | "entra_devops";
  name: string;
  baseUrl: string;
  webUrl: string | null;
  appId?: string | null;
  slug?: string | null;
  clientId?: string;
  hasPrivateKey?: boolean;
  callbackUrl?: string;
};

export const APP_KIND_LABEL = { github_app: "GitHub App", entra_devops: "Azure DevOps via Microsoft Entra ID" } as const;

export function CodeHostAppsSection() {
  const { data, loading, error, reload } = useApi<{ apps: CodeHostAppInfo[]; publicUrlSet: boolean }>("/api/code-host-apps");
  const [editing, setEditing] = useState<CodeHostAppInfo | "github_app" | "entra_devops" | null>(null);

  return (
    <Card
      title="Code host apps"
      actions={
        <>
          <Button size="sm" onClick={() => setEditing("github_app")}>Add GitHub App</Button>
          <Button size="sm" onClick={() => setEditing("entra_devops")}>Add Entra app</Button>
        </>
      }
    >
      <ErrorNote error={error} />
      {loading && !data ? (
        <div className="p-6 text-center"><Spinner /></div>
      ) : !data?.apps.length ? (
        <Empty title="No app registrations">
          Register a GitHub App so reviews post as a bot with short-lived tokens, or an Entra ID app so people connect Azure DevOps by signing in with Microsoft instead of creating a PAT.
        </Empty>
      ) : (
        <ul className="divide-y divide-border">
          {data.apps.map((a) => (
            <li key={a.id} className="flex items-center gap-3 px-4 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 font-medium">{a.name}<Badge tone="muted">{APP_KIND_LABEL[a.kind]}</Badge></div>
                <div className="truncate font-mono text-xs text-muted">Callback: {a.callbackUrl}</div>
              </div>
              <Button size="sm" onClick={() => setEditing(a)}>Edit</Button>
              <Button
                size="sm"
                variant="danger"
                onClick={async () => {
                  if (!confirm(`Remove ${a.name}? Every connection made through it is removed too.`)) return;
                  await api(`/api/code-host-apps/${a.id}`, { method: "DELETE" });
                  reload();
                }}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
      {!data?.publicUrlSet && !!data?.apps.length && (
        <p className="border-t border-border px-4 py-2 text-xs text-warn">Callback URLs use the address you opened the app on. Set PUBLIC_URL if GitHub or Microsoft should redirect somewhere else.</p>
      )}
      {editing && (
        <AppForm
          existing={typeof editing === "string" ? null : editing}
          kind={typeof editing === "string" ? editing : editing.kind}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
        />
      )}
    </Card>
  );
}

function AppForm({ existing, kind, onClose, onSaved }: { existing: CodeHostAppInfo | null; kind: CodeHostAppInfo["kind"]; onClose: () => void; onSaved: () => void }) {
  const gh = kind === "github_app";
  const [f, setF] = useState({
    name: existing?.name ?? (gh ? "GitHub App" : "Azure DevOps (Microsoft)"),
    baseUrl: existing?.baseUrl ?? (gh ? "https://api.github.com" : ""),
    webUrl: existing?.webUrl ?? "https://github.com",
    appId: existing?.appId ?? "",
    slug: existing?.slug ?? "",
    clientId: existing?.clientId ?? "",
    clientSecret: "",
    privateKey: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof typeof f>(k: K, v: string) => setF((x) => ({ ...x, [k]: v }));

  const save = async () => {
    setBusy(true);
    setError(null);
    const body = gh
      ? { kind, name: f.name, baseUrl: f.baseUrl, webUrl: f.webUrl, appId: f.appId, slug: f.slug, clientId: f.clientId, clientSecret: f.clientSecret || undefined, privateKey: f.privateKey || undefined }
      : { kind, name: f.name, baseUrl: f.baseUrl, clientId: f.clientId, clientSecret: f.clientSecret || undefined };
    try {
      if (existing) await api(`/api/code-host-apps/${existing.id}`, { method: "PATCH", body });
      else await api("/api/code-host-apps", { body });
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open wide onClose={onClose} title={existing ? `Edit ${existing.name}` : `Add ${APP_KIND_LABEL[kind]}`} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save} loading={busy}>Save</Button></>}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Name"><Input value={f.name} onChange={(e) => set("name", e.target.value)} /></Field>
        {gh ? (
          <>
            <Field label="App ID" hint="GitHub → Settings → Developer settings → GitHub Apps → your app"><Input value={f.appId} onChange={(e) => set("appId", e.target.value)} className="font-mono" /></Field>
            <Field label="App URL name (slug)" hint="From github.com/apps/<slug>"><Input value={f.slug} onChange={(e) => set("slug", e.target.value)} className="font-mono" /></Field>
            <Field label="Client ID"><Input value={f.clientId} onChange={(e) => set("clientId", e.target.value)} className="font-mono" /></Field>
            <Field label="Client secret" hint={existing ? "Leave blank to keep" : undefined}><Input type="password" value={f.clientSecret} onChange={(e) => set("clientSecret", e.target.value)} autoComplete="off" /></Field>
            <Field label="API base URL" hint="https://api.github.com, or https://HOST/api/v3"><Input value={f.baseUrl} onChange={(e) => set("baseUrl", e.target.value)} className="font-mono" /></Field>
            <Field label="Web URL" hint="https://github.com, or your Enterprise Server"><Input value={f.webUrl} onChange={(e) => set("webUrl", e.target.value)} className="font-mono" /></Field>
            <div className="sm:col-span-2">
              <Field label="Private key (PEM)" hint={existing?.hasPrivateKey ? "Leave blank to keep the saved key" : "Generate one on the app's settings page"}>
                <Textarea rows={4} value={f.privateKey} onChange={(e) => set("privateKey", e.target.value)} placeholder="-----BEGIN RSA PRIVATE KEY-----" className="font-mono text-xs" />
              </Field>
            </div>
            <div className="text-xs text-muted sm:col-span-2">
              <p className="mb-1 font-medium">App settings on GitHub</p>
              <ul className="list-inside list-disc space-y-0.5">
                <li>Permissions: <b>Pull requests: Read & write</b>, <b>Contents: Read</b>, <b>Metadata: Read</b>.</li>
                <li>Set both the <b>Callback URL</b> and the <b>Setup URL</b> to the callback shown after saving, and tick <b>Request user authorization (OAuth) during installation</b>.</li>
                <li>Reviews are posted as the app&apos;s bot account, and only repositories the app is installed on are visible.</li>
              </ul>
            </div>
          </>
        ) : (
          <>
            <Field label="Tenant ID or domain" hint="Microsoft Entra ID → Overview"><Input value={f.baseUrl} onChange={(e) => set("baseUrl", e.target.value)} placeholder="contoso.onmicrosoft.com" className="font-mono" /></Field>
            <Field label="Application (client) ID"><Input value={f.clientId} onChange={(e) => set("clientId", e.target.value)} className="font-mono" /></Field>
            <Field label="Client secret" hint={existing ? "Leave blank to keep" : undefined}><Input type="password" value={f.clientSecret} onChange={(e) => set("clientSecret", e.target.value)} autoComplete="off" /></Field>
            <div className="text-xs text-muted sm:col-span-2">
              <p className="mb-1 font-medium">App registration in Entra ID</p>
              <ul className="list-inside list-disc space-y-0.5">
                <li>Add a <b>Web</b> redirect URI: the callback shown after saving.</li>
                <li>API permissions: <b>Azure DevOps → user_impersonation</b> (delegated), then grant admin consent if your tenant requires it.</li>
                <li>Each person signs in with Microsoft and gets their own connection with their own Azure DevOps access; refresh tokens are stored encrypted.</li>
              </ul>
            </div>
          </>
        )}
      </div>
      <div className="mt-4"><ErrorNote error={error} /></div>
    </Modal>
  );
}

/** Connection options for app registrations, shown in the Add connection dialog. Navigates away to the host. */
export function AppConnectOptions({ apps }: { apps: CodeHostAppInfo[] }) {
  const [choice, setChoice] = useState(apps[0]?.id ?? "");
  const [name, setName] = useState("");
  const [orgUrl, setOrgUrl] = useState("");
  const app = apps.find((a) => a.id === choice);
  if (!app) return null;
  const go = (install?: boolean) => {
    const q = new URLSearchParams({ name });
    if (app.kind === "entra_devops") q.set("orgUrl", orgUrl);
    if (install) q.set("install", "1");
    window.location.href = `/api/code-host-apps/${app.id}/connect?${q}`;
  };
  return (
    <div className="space-y-4">
      <Field label="App">
        <Select value={choice} onChange={(e) => setChoice(e.target.value)}>
          {apps.map((a) => <option key={a.id} value={a.id}>{a.name} ({APP_KIND_LABEL[a.kind]})</option>)}
        </Select>
      </Field>
      <Field label="Display name" hint="Optional"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
      {app.kind === "entra_devops" ? (
        <>
          <Field label="Organization URL"><Input type="url" value={orgUrl} onChange={(e) => setOrgUrl(e.target.value)} placeholder="https://dev.azure.com/your-org" /></Field>
          <Button variant="primary" disabled={!/^https?:\/\//.test(orgUrl)} onClick={() => go()}>Sign in with Microsoft</Button>
        </>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" onClick={() => go()}>Connect existing installations</Button>
          <Button onClick={() => go(true)}>Install on another account</Button>
          <p className="w-full text-xs text-muted">You&apos;ll authorize the app on GitHub; every installation you can access is added as a connection.</p>
        </div>
      )}
    </div>
  );
}
