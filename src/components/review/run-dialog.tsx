"use client";

import { useEffect, useState } from "react";
import { useApi, type AiProviderInfo } from "@/lib/hooks";
import { Button, ErrorNote, Field, Input, Modal, Select, Textarea } from "../ui";

export type RunOptions = { providerId: string; instructions: string; extraIgnore: string[]; fullFileContext: boolean };

const FOCUS_PRESETS = [
  { label: "General", text: "" },
  { label: "Security", text: "Focus on security: authentication/authorization, input validation, injection, secrets handling, and unsafe dependencies." },
  { label: "Performance", text: "Focus on performance and scalability: query patterns, allocations, caching, concurrency, and hot paths." },
  { label: "Strict", text: "Hold this PR to a high bar: flag missing tests for new logic, unclear naming, missing error handling, and any API contract changes." },
];

export function RunDialog({ open, onClose, onRun, repoKey, stats }: {
  open: boolean;
  onClose: () => void;
  onRun: (o: RunOptions) => Promise<void>;
  repoKey: string;
  stats: { files: number; additions: number; deletions: number };
}) {
  const providers = useApi<{ providers: AiProviderInfo[] }>(open ? "/api/ai-providers" : null);
  const [providerId, setProviderId] = useState("");
  const [instructions, setInstructions] = useState("");
  const [ignore, setIgnore] = useState("");
  const [fullFileContext, setFullFileContext] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const storageKey = `review-opts:${repoKey}`;

  useEffect(() => {
    if (!open) return;
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) ?? "{}");
      if (saved.instructions) setInstructions(saved.instructions);
      if (saved.ignore) setIgnore(saved.ignore);
      if (saved.providerId) setProviderId(saved.providerId);
    } catch {}
  }, [open, storageKey]);

  useEffect(() => {
    const list = providers.data?.providers;
    if (!list?.length) return;
    if (!list.some((p) => p.id === providerId)) setProviderId((list.find((p) => p.isDefault) ?? list[0]).id);
  }, [providers.data, providerId]);

  const provider = providers.data?.providers.find((p) => p.id === providerId);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      try {
        localStorage.setItem(storageKey, JSON.stringify({ instructions, ignore, providerId }));
      } catch {}
      await onRun({
        providerId,
        instructions: instructions.trim(),
        extraIgnore: ignore.split(/[\n,]/).map((s) => s.trim()).filter(Boolean),
        fullFileContext,
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Run AI review"
      wide
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={run} loading={busy} disabled={!providerId}>Start review</Button></>}
    >
      <div className="space-y-4">
        <Field label="Model">
          <Select value={providerId} onChange={(e) => setProviderId(e.target.value)}>
            {providers.data?.providers.map((p) => (
              <option key={p.id} value={p.id}>{p.name}: {p.model}{p.isLocal ? " (local)" : ""}</option>
            ))}
          </Select>
        </Field>
        {providers.data && !providers.data.providers.length && <ErrorNote error="No AI providers yet. An admin can add one in Settings." />}
        {provider && !provider.isLocal && (
          <p className="rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">
            The changed code will be sent to <b>{provider.baseUrl}</b>. Common secret patterns are masked first. For sensitive repositories, use a local model.
          </p>
        )}
        <Field label="Review focus">
          <div className="mb-2 flex flex-wrap gap-1.5">
            {FOCUS_PRESETS.map((p) => (
              <Button key={p.label} size="sm" variant={instructions === p.text ? "primary" : "default"} onClick={() => setInstructions(p.text)}>{p.label}</Button>
            ))}
          </div>
          <Textarea rows={4} value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="Optional: team conventions or what to focus on, e.g. “We use Result<T> instead of exceptions; all DB access goes through repositories.”" />
        </Field>
        <Field label="Extra files to skip" hint="Glob patterns, separated by commas. Lockfiles, build output, minified files and images are already skipped.">
          <Input value={ignore} onChange={(e) => setIgnore(e.target.value)} placeholder="**/*.test.ts, docs/**" className="font-mono" />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={fullFileContext} onChange={(e) => setFullFileContext(e.target.checked)} />
          Send the full file for context when it fits (better reviews, more tokens)
        </label>
        <p className="text-xs text-muted">
          {stats.files} files · +{stats.additions} / -{stats.deletions}. The review runs in the background, and you can keep reading the diff while it works.
        </p>
        <ErrorNote error={error} />
      </div>
    </Modal>
  );
}
