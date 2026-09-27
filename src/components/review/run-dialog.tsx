"use client";

import { useEffect, useState } from "react";
import { useApi, type AiProviderInfo, type ReviewProfileInfo, type Severity } from "@/lib/hooks";
import { MIN_SEVERITY_OPTIONS, ProfileForm, parseGlobs } from "../profile-form";
import { Badge, Button, ErrorNote, Field, Input, Modal, Select, Textarea, timeAgo } from "../ui";
import type { RepoRulesInfo, ReviewListItem } from "./types";

export type RunOptions = {
  providerId: string;
  instructions: string;
  extraIgnore: string[];
  fullFileContext: boolean;
  minSeverity: Severity | null;
  repoRules: boolean;
  profileId: string | null;
  incremental: boolean;
  baseReviewId: string | null;
};

type LoadedRules = { path: string; ref: string; rules: Omit<RepoRulesInfo, "path" | "ref" | "warnings"> | null; warnings: string[] } | null;

const FOCUS_PRESETS = [
  { label: "General", text: "" },
  { label: "Security", text: "Focus on security: authentication/authorization, input validation, injection, secrets handling, and unsafe dependencies." },
  { label: "Performance", text: "Focus on performance and scalability: query patterns, allocations, caching, concurrency, and hot paths." },
  { label: "Strict", text: "Hold this PR to a high bar: flag missing tests for new logic, unclear naming, missing error handling, and any API contract changes." },
];

export function RunDialog({ open, onClose, onRun, connId, owner, repo, baseSha, headSha, previousReview, stats }: {
  open: boolean;
  onClose: () => void;
  onRun: (o: RunOptions) => Promise<void>;
  connId: string;
  owner: string;
  repo: string;
  baseSha: string;
  headSha: string;
  /** Newest completed AI review at an older commit, if any. */
  previousReview: ReviewListItem | null;
  stats: { files: number; additions: number; deletions: number };
}) {
  const providers = useApi<{ providers: AiProviderInfo[] }>(open ? "/api/ai-providers" : null);
  const profiles = useApi<{ profiles: ReviewProfileInfo[] }>(open ? "/api/profiles" : null);
  const rulesQ = useApi<{ rules: LoadedRules }>(open && baseSha ? `/api/c/${connId}/pulls/${owner}/${repo}/rules?ref=${encodeURIComponent(baseSha)}` : null);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [providerId, setProviderId] = useState("");
  const [instructions, setInstructions] = useState("");
  const [ignore, setIgnore] = useState("");
  const [fullFileContext, setFullFileContext] = useState(true);
  const [minSeverity, setMinSeverity] = useState<Severity | null>(null);
  const [applyRepoRules, setApplyRepoRules] = useState(true);
  const [incremental, setIncremental] = useState(true);
  const [savingProfile, setSavingProfile] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const storageKey = `review-opts:${owner}/${repo}`;

  useEffect(() => {
    if (!open) return;
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) ?? "{}");
      if (saved.instructions) setInstructions(saved.instructions);
      if (saved.ignore) setIgnore(saved.ignore);
      if (saved.providerId) setProviderId(saved.providerId);
      if (saved.minSeverity) setMinSeverity(saved.minSeverity);
      if (saved.profileId) setProfileId(saved.profileId);
    } catch {}
  }, [open, storageKey]);

  // Forget a remembered profile that was deleted or unshared.
  useEffect(() => {
    if (profileId && profiles.data && !profiles.data.profiles.some((p) => p.id === profileId)) setProfileId(null);
  }, [profiles.data, profileId]);

  useEffect(() => {
    const list = providers.data?.providers;
    if (!list?.length) return;
    if (!list.some((p) => p.id === providerId)) setProviderId((list.find((p) => p.isDefault) ?? list[0]).id);
  }, [providers.data, providerId]);

  const applyProfile = (id: string | null) => {
    setProfileId(id);
    const p = profiles.data?.profiles.find((x) => x.id === id);
    if (!p) return;
    const list = providers.data?.providers ?? [];
    setProviderId(p.providerId && list.some((x) => x.id === p.providerId) ? p.providerId : ((list.find((x) => x.isDefault) ?? list[0])?.id ?? ""));
    setInstructions(p.instructions ?? "");
    setIgnore(p.extraIgnore.join(", "));
    setFullFileContext(p.fullFileContext);
    setMinSeverity(p.minSeverity);
  };

  const provider = providers.data?.providers.find((p) => p.id === providerId);
  const profile = profiles.data?.profiles.find((p) => p.id === profileId);
  const loaded = rulesQ.data?.rules ?? null;

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      try {
        localStorage.setItem(storageKey, JSON.stringify({ instructions, ignore, providerId, minSeverity, profileId }));
      } catch {}
      await onRun({
        providerId,
        instructions: instructions.trim(),
        extraIgnore: parseGlobs(ignore),
        fullFileContext,
        minSeverity,
        repoRules: applyRepoRules,
        profileId,
        incremental: Boolean(previousReview && incremental),
        baseReviewId: previousReview && incremental ? previousReview.id : null,
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
    <Modal
      open={open && !savingProfile}
      onClose={onClose}
      title="Run AI review"
      wide
      footer={
        <>
          <Button className="mr-auto" onClick={() => setSavingProfile(true)}>Save as profile…</Button>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={run} loading={busy} disabled={!providerId}>Start review</Button>
        </>
      }
    >
      <div className="space-y-4">
        {!!profiles.data?.profiles.length && (
          <Field label="Profile" hint={profile?.description ?? "Fills in the settings below. You can still adjust them for this run."}>
            <Select value={profileId ?? ""} onChange={(e) => applyProfile(e.target.value || null)}>
              <option value="">No profile</option>
              {profiles.data.profiles.map((p) => (
                <option key={p.id} value={p.id}>{p.name}{p.shared ? " (shared)" : ""}</option>
              ))}
            </Select>
          </Field>
        )}
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
        <RepoRulesPanel loaded={loaded} loading={rulesQ.loading} error={rulesQ.error} apply={applyRepoRules} onApply={setApplyRepoRules} />
        <Field label="Review focus">
          <div className="mb-2 flex flex-wrap gap-1.5">
            {FOCUS_PRESETS.map((p) => (
              <Button key={p.label} size="sm" variant={instructions === p.text ? "primary" : "default"} onClick={() => setInstructions(p.text)}>{p.label}</Button>
            ))}
          </div>
          <Textarea rows={4} value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="Optional: team conventions or what to focus on, e.g. “We use Result<T> instead of exceptions; all DB access goes through repositories.”" />
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Extra files to skip" hint="Glob patterns, separated by commas. Lockfiles, build output, minified files and images are already skipped.">
            <Input value={ignore} onChange={(e) => setIgnore(e.target.value)} placeholder="**/*.test.ts, docs/**" className="font-mono" />
          </Field>
          <Field label="Report findings" hint="Lower-severity findings are dropped. The stricter of this and the repository rules wins.">
            <Select value={minSeverity ?? ""} onChange={(e) => setMinSeverity((e.target.value || null) as Severity | null)}>
              {MIN_SEVERITY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
          </Field>
        </div>
        {previousReview && (
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1" checked={incremental} onChange={(e) => setIncremental(e.target.checked)} />
            <span>
              Only review files changed since the last review
              <span className="block text-xs text-muted">
                The review from {timeAgo(previousReview.createdAt)} covered <code>{previousReview.headSha.slice(0, 7)}</code>; the PR is now at <code>{headSha.slice(0, 7)}</code>.
                Findings on unchanged files are carried over with their accept/dismiss state.
              </span>
            </span>
          </label>
        )}
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
      {savingProfile && (
        <ProfileForm
          initial={{ providerId, instructions, extraIgnore: parseGlobs(ignore), fullFileContext, minSeverity }}
          onClose={() => setSavingProfile(false)}
          onSaved={async (id) => {
            setSavingProfile(false);
            await profiles.reload();
            setProfileId(id);
          }}
        />
      )}
    </>
  );
}

function RepoRulesPanel({ loaded, loading, error, apply, onApply }: {
  loaded: LoadedRules;
  loading: boolean;
  error: string | null;
  apply: boolean;
  onApply: (v: boolean) => void;
}) {
  if (loading && !loaded) return <p className="text-xs text-muted">Checking the target branch for .pr-review.yml…</p>;
  if (error) return <p className="text-xs text-muted">Couldn&apos;t check for repository rules: {error}</p>;
  if (!loaded) {
    return (
      <p className="text-xs text-muted">
        No <code>.pr-review.yml</code> on the target branch. Add one to share review rules with everyone who reviews this repository.
      </p>
    );
  }
  const r = loaded.rules;
  return (
    <div className="rounded-md border border-border bg-panel px-3 py-2 text-sm">
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={apply} onChange={(e) => onApply(e.target.checked)} disabled={!r} />
        <span>Apply repository rules from <code className="text-xs">{loaded.path}</code></span>
        <span className="ml-auto flex gap-1">
          {r?.minSeverity && <Badge tone="muted">{r.minSeverity}+</Badge>}
          {!!r?.ignore.length && <Badge tone="muted">{r.ignore.length} skip</Badge>}
          {!!r?.pathInstructions.length && <Badge tone="muted">{r.pathInstructions.length} path rules</Badge>}
        </span>
      </label>
      {r?.instructions && (
        <details className="mt-1 text-xs text-muted">
          <summary className="cursor-pointer">Instructions</summary>
          <pre className="mt-1 whitespace-pre-wrap font-sans">{r.instructions}</pre>
        </details>
      )}
      {loaded.warnings.length > 0 && (
        <ul className="mt-1 list-inside list-disc text-xs text-warn">{loaded.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
      )}
    </div>
  );
}
