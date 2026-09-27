"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { ROLE_INFO, type Role } from "@/lib/permissions";
import { Badge, Button, Card, Empty, ErrorNote, Field, Input, Modal, Select, Spinner, timeAgo } from "@/components/ui";

type UserRow = {
  id: string;
  email: string;
  name: string;
  role: Role;
  hasPassword: boolean;
  sso: string[];
  disabledAt: string | null;
  lastLoginAt: string | null;
};

type SsoKind = "entra" | "google" | "oidc" | "github";
type SsoRow = {
  id: string;
  kind: SsoKind;
  name: string;
  issuer: string;
  issuerInput: string;
  clientId: string;
  enabled: boolean;
  allowedDomains: string[];
  autoCreateUsers: boolean;
  defaultRole: Role;
  redirectUri: string;
};

const ROLES = Object.keys(ROLE_INFO) as Role[];

export function UsersSection({ currentUserId }: { currentUserId: string }) {
  const { data, loading, error, reload } = useApi<{ users: UserRow[] }>("/api/users");
  const [actionError, setActionError] = useState<string | null>(null);
  const update = async (u: UserRow, body: { role?: Role; disabled?: boolean }) => {
    setActionError(null);
    try {
      await api(`/api/users/${u.id}`, { method: "PATCH", body });
      reload();
    } catch (err) {
      setActionError((err as Error).message);
    }
  };

  return (
    <Card title="Users and roles">
      <ErrorNote error={error ?? actionError} />
      {loading && !data ? (
        <div className="p-6 text-center"><Spinner /></div>
      ) : (
        <>
          <ul className="divide-y divide-border">
            {data?.users.map((u) => (
              <li key={u.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 font-medium">
                    {u.name}
                    {u.id === currentUserId && <Badge tone="muted">you</Badge>}
                    {u.disabledAt && <Badge tone="danger">deactivated</Badge>}
                  </div>
                  <div className="truncate text-xs text-muted">
                    {u.email} · {[u.hasPassword && "password", ...u.sso].filter(Boolean).join(", ") || "no sign-in method"} · {u.lastLoginAt ? `last sign-in ${timeAgo(u.lastLoginAt)}` : "never signed in"}
                  </div>
                </div>
                <Select className="h-7 w-32 text-xs" value={u.role} onChange={(e) => void update(u, { role: e.target.value as Role })} aria-label={`Role for ${u.name}`}>
                  {ROLES.map((r) => <option key={r} value={r}>{ROLE_INFO[r].label}</option>)}
                </Select>
                {u.id !== currentUserId && (
                  <Button size="sm" variant={u.disabledAt ? "default" : "danger"} onClick={() => void update(u, { disabled: !u.disabledAt })}>
                    {u.disabledAt ? "Reactivate" : "Deactivate"}
                  </Button>
                )}
              </li>
            ))}
          </ul>
          <dl className="grid grid-cols-1 gap-x-4 gap-y-1 border-t border-border px-4 py-3 text-xs sm:grid-cols-2">
            {ROLES.map((r) => (
              <div key={r}><dt className="inline font-medium">{ROLE_INFO[r].label}: </dt><dd className="inline text-muted">{ROLE_INFO[r].description}</dd></div>
            ))}
          </dl>
        </>
      )}
    </Card>
  );
}

const KIND_LABEL: Record<SsoKind, string> = { entra: "Microsoft Entra ID", google: "Google", oidc: "OpenID Connect", github: "GitHub" };

export function SsoSection() {
  const { data, loading, error, reload } = useApi<{ providers: SsoRow[]; callbackBase: string; publicUrlSet: boolean; settings: { localLogin: boolean } }>("/api/sso-providers");
  const [editing, setEditing] = useState<SsoRow | "new" | null>(null);
  const [created, setCreated] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const setLocalLogin = async (localLogin: boolean) => {
    setSaveError(null);
    try {
      await api("/api/auth-settings", { method: "PUT", body: { localLogin } });
      reload();
    } catch (err) {
      setSaveError((err as Error).message);
    }
  };

  return (
    <Card title="Single sign-on" actions={<Button size="sm" variant="primary" onClick={() => setEditing("new")}>Add sign-in provider</Button>}>
      <ErrorNote error={error ?? saveError} />
      {loading && !data ? (
        <div className="p-6 text-center"><Spinner /></div>
      ) : (
        <>
          {!data?.providers.length ? (
            <Empty title="Only password sign-in is set up">Add Microsoft Entra ID, Google, GitHub or any OpenID Connect provider so your team signs in with their work account.</Empty>
          ) : (
            <ul className="divide-y divide-border">
              {data.providers.map((p) => (
                <li key={p.id} className="flex items-center gap-3 px-4 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 font-medium">
                      {p.name}
                      <Badge tone="muted">{KIND_LABEL[p.kind]}</Badge>
                      {!p.enabled && <Badge tone="warn">disabled</Badge>}
                    </div>
                    <div className="truncate text-xs text-muted">
                      {p.allowedDomains.length ? p.allowedDomains.join(", ") : "any verified email"} · {p.autoCreateUsers ? `new users join as ${ROLE_INFO[p.defaultRole].label}` : "existing accounts only"}
                    </div>
                  </div>
                  <Button size="sm" onClick={() => setEditing(p)}>Edit</Button>
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={async () => {
                      if (!confirm(`Remove ${p.name}? People who only sign in with it will need another way in.`)) return;
                      await api(`/api/sso-providers/${p.id}`, { method: "DELETE" });
                      reload();
                    }}
                  >
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <div className="border-t border-border px-4 py-3 text-sm">
            <label className="flex items-start gap-2">
              <input type="checkbox" className="mt-1" checked={data?.settings.localLogin ?? true} onChange={(e) => void setLocalLogin(e.target.checked)} />
              <span>
                Allow email and password sign-in for everyone
                <span className="block text-xs text-muted">When off, only admins can use a password (so you can't lock yourself out); everyone else signs in with SSO.</span>
              </span>
            </label>
          </div>
        </>
      )}
      {editing && (
        <SsoForm
          existing={editing === "new" ? null : editing}
          callbackBase={data?.callbackBase ?? ""}
          publicUrlSet={data?.publicUrlSet ?? false}
          onClose={() => setEditing(null)}
          onSaved={(redirectUri) => {
            setEditing(null);
            reload();
            if (redirectUri) setCreated(redirectUri);
          }}
        />
      )}
      {created && (
        <Modal open onClose={() => setCreated(null)} title="Register the redirect URI" footer={<Button variant="primary" onClick={() => setCreated(null)}>Done</Button>}>
          <p className="mb-2 text-sm">Add this redirect (callback) URI to the app registration at the provider, then try signing in from a private window:</p>
          <Input readOnly value={created} className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
        </Modal>
      )}
    </Card>
  );
}

function SsoForm({ existing, callbackBase, publicUrlSet, onClose, onSaved }: {
  existing: SsoRow | null;
  callbackBase: string;
  publicUrlSet: boolean;
  onClose: () => void;
  onSaved: (redirectUri: string | null) => void;
}) {
  const [f, setF] = useState({
    kind: existing?.kind ?? ("entra" as SsoKind),
    name: existing?.name ?? "",
    issuer: existing?.issuerInput ?? "",
    clientId: existing?.clientId ?? "",
    clientSecret: "",
    enabled: existing?.enabled ?? true,
    domains: existing?.allowedDomains.join(", ") ?? "",
    autoCreateUsers: existing?.autoCreateUsers ?? true,
    defaultRole: existing?.defaultRole ?? ("reviewer" as Role),
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const body = {
        kind: f.kind,
        name: f.name || KIND_LABEL[f.kind],
        issuer: f.issuer,
        clientId: f.clientId,
        clientSecret: f.clientSecret || undefined,
        enabled: f.enabled,
        allowedDomains: f.domains.split(/[\s,]+/).map((d) => d.trim()).filter(Boolean),
        autoCreateUsers: f.autoCreateUsers,
        defaultRole: f.defaultRole,
      };
      if (existing) {
        await api(`/api/sso-providers/${existing.id}`, { method: "PATCH", body });
        onSaved(null);
      } else {
        const r = await api<{ redirectUri: string }>("/api/sso-providers", { body });
        onSaved(r.redirectUri);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const issuerField =
    f.kind === "entra" ? { label: "Tenant ID or primary domain", placeholder: "contoso.onmicrosoft.com", hint: "Entra ID → Overview → Tenant ID" }
    : f.kind === "oidc" ? { label: "Issuer URL", placeholder: "https://id.example.com/realms/eng", hint: "Discovery is read from /.well-known/openid-configuration" }
    : f.kind === "github" ? { label: "GitHub URL", placeholder: "https://github.com", hint: "Leave empty for github.com, or enter your Enterprise Server URL" }
    : null;

  return (
    <Modal open wide onClose={onClose} title={existing ? `Edit ${existing.name}` : "Add sign-in provider"} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save} loading={busy} disabled={!f.clientId || (!existing && !f.clientSecret)}>Save</Button></>}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Provider">
          <Select value={f.kind} onChange={(e) => set("kind", e.target.value as SsoKind)} disabled={Boolean(existing)}>
            {(Object.keys(KIND_LABEL) as SsoKind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
          </Select>
        </Field>
        <Field label="Button label">
          <Input value={f.name} onChange={(e) => set("name", e.target.value)} placeholder={KIND_LABEL[f.kind]} />
        </Field>
        {issuerField && (
          <div className="sm:col-span-2">
            <Field label={issuerField.label} hint={issuerField.hint}>
              <Input value={f.issuer} onChange={(e) => set("issuer", e.target.value)} placeholder={issuerField.placeholder} className="font-mono" />
            </Field>
          </div>
        )}
        <Field label={f.kind === "entra" ? "Application (client) ID" : "Client ID"}>
          <Input value={f.clientId} onChange={(e) => set("clientId", e.target.value)} className="font-mono" />
        </Field>
        <Field label="Client secret" hint={existing ? "Leave blank to keep the saved secret" : "Stored encrypted"}>
          <Input type="password" value={f.clientSecret} onChange={(e) => set("clientSecret", e.target.value)} autoComplete="off" />
        </Field>
        <Field label="Allowed email domains" hint="Comma-separated. Empty allows any verified email.">
          <Input value={f.domains} onChange={(e) => set("domains", e.target.value)} placeholder="contoso.com" />
        </Field>
        <Field label="Role for new users">
          <Select value={f.defaultRole} onChange={(e) => set("defaultRole", e.target.value as Role)}>
            {ROLES.map((r) => <option key={r} value={r}>{ROLE_INFO[r].label}</option>)}
          </Select>
        </Field>
        <div className="space-y-2 text-sm sm:col-span-2">
          <label className="flex items-center gap-2"><input type="checkbox" checked={f.autoCreateUsers} onChange={(e) => set("autoCreateUsers", e.target.checked)} /> Create an account the first time someone signs in</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={f.enabled} onChange={(e) => set("enabled", e.target.checked)} /> Show on the sign-in page</label>
          <p className="text-xs text-muted">
            Existing accounts are matched by verified email and linked automatically. Redirect URI to register at the provider:{" "}
            <code>{existing ? existing.redirectUri : callbackBase}</code>{!existing && " (the exact URI is shown after saving)"}.
            {!publicUrlSet && " Set PUBLIC_URL if people reach the app at a different address."}
          </p>
        </div>
      </div>
      <div className="mt-4"><ErrorNote error={error} /></div>
    </Modal>
  );
}
