"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { useApi, type AiProviderInfo, type ReviewProfileInfo, type Severity } from "@/lib/hooks";
import { Button, ErrorNote, Field, Input, Modal, Select, Textarea } from "./ui";

export type ProfileDraft = {
  name: string;
  description: string;
  shared: boolean;
  providerId: string | null;
  instructions: string;
  extraIgnore: string[];
  fullFileContext: boolean;
  minSeverity: Severity | null;
};

export const MIN_SEVERITY_OPTIONS: { value: Severity | ""; label: string }[] = [
  { value: "", label: "Everything (including nits)" },
  { value: "minor", label: "Minor and above" },
  { value: "major", label: "Major and above" },
  { value: "critical", label: "Critical only" },
];

export function parseGlobs(s: string) {
  return s.split(/[\n,]/).map((x) => x.trim()).filter(Boolean);
}

/** Create or edit a review profile. `initial` pre-fills a new profile (e.g. from the run dialog). */
export function ProfileForm({ existing, initial, canShare = false, onClose, onSaved }: {
  existing?: ReviewProfileInfo | null;
  /** Leads and admins may share profiles with everyone. */
  canShare?: boolean;
  initial?: Partial<ProfileDraft>;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const providers = useApi<{ providers: AiProviderInfo[] }>("/api/ai-providers");
  const [form, setForm] = useState<ProfileDraft>({
    name: existing?.name ?? initial?.name ?? "",
    description: existing?.description ?? initial?.description ?? "",
    shared: existing?.shared ?? initial?.shared ?? false,
    providerId: existing ? existing.providerId : (initial?.providerId ?? null),
    instructions: existing?.instructions ?? initial?.instructions ?? "",
    extraIgnore: existing?.extraIgnore ?? initial?.extraIgnore ?? [],
    fullFileContext: existing?.fullFileContext ?? initial?.fullFileContext ?? true,
    minSeverity: existing ? existing.minSeverity : (initial?.minSeverity ?? null),
  });
  const [ignore, setIgnore] = useState(form.extraIgnore.join(", "));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof ProfileDraft>(k: K, v: ProfileDraft[K]) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const body = { ...form, extraIgnore: parseGlobs(ignore) };
      if (existing) {
        await api(`/api/profiles/${existing.id}`, { method: "PATCH", body });
        onSaved(existing.id);
      } else {
        const { id } = await api<{ id: string }>("/api/profiles", { body });
        onSaved(id);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={existing ? `Edit profile "${existing.name}"` : "New review profile"}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save} loading={busy} disabled={!form.name.trim()}>Save profile</Button></>}
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Name">
          <Input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Backend security pass" autoFocus />
        </Field>
        <Field label="Model">
          <Select value={form.providerId ?? ""} onChange={(e) => set("providerId", e.target.value || null)}>
            <option value="">Default provider</option>
            {providers.data?.providers.map((p) => <option key={p.id} value={p.id}>{p.name}: {p.model}</option>)}
          </Select>
        </Field>
        <div className="sm:col-span-2">
          <Field label="Description" hint="Optional. Shown in the run dialog.">
            <Input value={form.description} onChange={(e) => set("description", e.target.value)} />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Field label="Review instructions">
            <Textarea rows={5} value={form.instructions} onChange={(e) => set("instructions", e.target.value)} placeholder="What to focus on and team conventions to enforce." />
          </Field>
        </div>
        <Field label="Extra files to skip" hint="Glob patterns, separated by commas">
          <Input value={ignore} onChange={(e) => setIgnore(e.target.value)} className="font-mono" placeholder="**/*.test.ts, docs/**" />
        </Field>
        <Field label="Report findings" hint="Lower-severity findings are dropped">
          <Select value={form.minSeverity ?? ""} onChange={(e) => set("minSeverity", (e.target.value || null) as Severity | null)}>
            {MIN_SEVERITY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
        </Field>
        <div className="space-y-2 sm:col-span-2">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.fullFileContext} onChange={(e) => set("fullFileContext", e.target.checked)} />
            Send the full file for context when it fits
          </label>
          {(canShare || form.shared) && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.shared} disabled={!canShare} onChange={(e) => set("shared", e.target.checked)} />
              Share with everyone on this server (only you, leads and admins can change it)
            </label>
          )}
        </div>
      </div>
      <div className="mt-4"><ErrorNote error={error} /></div>
    </Modal>
  );
}
