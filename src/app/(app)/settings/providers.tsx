"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { useApi, type AiProviderInfo } from "@/lib/hooks";
import { Badge, Button, Card, Empty, ErrorNote, Field, Input, Modal, Select, Spinner } from "@/components/ui";

type Preset = { label: string; baseUrl: string; model: string; isLocal: boolean; ctx: number; needsKey: boolean; note?: string };

// Everything here speaks the OpenAI Chat Completions protocol.
const PRESETS: Preset[] = [
  { label: "Ollama (docker compose)", baseUrl: "http://ollama:11434/v1", model: "qwen2.5-coder:14b", isLocal: true, ctx: 16000, needsKey: false, note: "Set OLLAMA_CONTEXT_LENGTH on the Ollama server to at least the context size below." },
  { label: "Ollama (host machine)", baseUrl: "http://host.docker.internal:11434/v1", model: "qwen2.5-coder:14b", isLocal: true, ctx: 16000, needsKey: false },
  { label: "LM Studio", baseUrl: "http://host.docker.internal:1234/v1", model: "", isLocal: true, ctx: 16000, needsKey: false },
  { label: "vLLM / LocalAI / llama.cpp", baseUrl: "http://localhost:8000/v1", model: "", isLocal: true, ctx: 32000, needsKey: false },
  { label: "OpenAI", baseUrl: "https://api.openai.com/v1", model: "", isLocal: false, ctx: 128000, needsKey: true },
  { label: "Anthropic (OpenAI-compatible endpoint)", baseUrl: "https://api.anthropic.com/v1", model: "claude-sonnet-5", isLocal: false, ctx: 200000, needsKey: true, note: "Turn off JSON mode for this endpoint; the prompt already enforces JSON." },
  { label: "Google Gemini (OpenAI-compatible endpoint)", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", model: "", isLocal: false, ctx: 200000, needsKey: true },
  { label: "Azure OpenAI / AI Foundry (v1 API)", baseUrl: "https://YOUR-RESOURCE.openai.azure.com/openai/v1", model: "your-deployment-name", isLocal: false, ctx: 128000, needsKey: true },
  { label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", model: "", isLocal: false, ctx: 128000, needsKey: true },
  { label: "Groq", baseUrl: "https://api.groq.com/openai/v1", model: "", isLocal: false, ctx: 128000, needsKey: true },
  { label: "Custom endpoint", baseUrl: "", model: "", isLocal: false, ctx: 16000, needsKey: false },
];

export function ProvidersSection({ isAdmin }: { isAdmin: boolean }) {
  const { data, loading, error, reload } = useApi<{ providers: AiProviderInfo[] }>("/api/ai-providers");
  const [editing, setEditing] = useState<AiProviderInfo | "new" | null>(null);

  return (
    <Card title="AI providers" actions={isAdmin && <Button size="sm" variant="primary" onClick={() => setEditing("new")}>Add provider</Button>}>
      <ErrorNote error={error} />
      {loading && !data ? (
        <div className="p-6 text-center"><Spinner /></div>
      ) : !data?.providers.length ? (
        <Empty title="No AI providers configured">
          {isAdmin ? "Add a local model (Ollama, LM Studio, vLLM) or a cloud provider. Any OpenAI-compatible endpoint works." : "Ask an admin to add an AI provider."}
        </Empty>
      ) : (
        <ul className="divide-y divide-border">
          {data.providers.map((p) => (
            <li key={p.id} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 font-medium">
                  {p.name}
                  {p.isDefault && <Badge tone="accent">default</Badge>}
                  {p.isLocal ? <Badge tone="ok">local</Badge> : <Badge tone="warn">cloud</Badge>}
                </div>
                <div className="truncate font-mono text-xs text-muted">
                  {p.model} · {p.baseUrl} · {p.maxContextTokens.toLocaleString()} ctx
                </div>
              </div>
              {isAdmin && (
                <>
                  <Button size="sm" onClick={() => setEditing(p)}>Edit</Button>
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={async () => {
                      if (!confirm(`Delete provider "${p.name}"?`)) return;
                      await api(`/api/ai-providers/${p.id}`, { method: "DELETE" });
                      reload();
                    }}
                  >
                    Delete
                  </Button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {editing && (
        <ProviderForm
          existing={editing === "new" ? null : editing}
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

function ProviderForm({ existing, onClose, onSaved }: { existing: AiProviderInfo | null; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    name: existing?.name ?? "",
    baseUrl: existing?.baseUrl ?? "",
    apiKey: "",
    model: existing?.model ?? "",
    temperature: existing?.temperature ?? 0.1,
    maxContextTokens: existing?.maxContextTokens ?? 16000,
    jsonMode: existing?.jsonMode ?? true,
    isLocal: existing?.isLocal ?? false,
    isDefault: existing?.isDefault ?? false,
  });
  const [note, setNote] = useState<string | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [busy, setBusy] = useState<"save" | "test" | "models" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  // Leaving the key blank while editing keeps the stored one.
  const payload = () => ({
    ...form,
    apiKey: existing && !form.apiKey ? undefined : form.apiKey,
    id: existing?.id,
  });

  function applyPreset(label: string) {
    const p = PRESETS.find((x) => x.label === label);
    if (!p) return;
    setForm((f) => ({
      ...f,
      name: f.name || p.label.replace(/ \(.*\)$/, ""),
      baseUrl: p.baseUrl,
      model: p.model || f.model,
      isLocal: p.isLocal,
      maxContextTokens: p.ctx,
      jsonMode: !p.label.startsWith("Anthropic"),
    }));
    setNote(p.note ?? (p.needsKey ? "This provider requires an API key." : null));
  }

  async function run(kind: "save" | "test" | "models") {
    setBusy(kind);
    setError(null);
    try {
      if (kind === "save") {
        const { id: _id, ...body } = payload();
        if (existing) await api(`/api/ai-providers/${existing.id}`, { method: "PATCH", body });
        else await api("/api/ai-providers", { body });
        onSaved();
      } else if (kind === "test") {
        setTestResult(null);
        const r = await api<{ ok: boolean; latencyMs?: number; reply?: string; error?: string }>("/api/ai-providers/test", { body: payload() });
        setTestResult(r.ok ? `✓ Connected in ${r.latencyMs} ms. Reply: ${r.reply}` : `✗ ${r.error}`);
      } else {
        const r = await api<{ models: string[]; error?: string }>("/api/ai-providers/models", { body: { ...payload(), model: form.model || "unused" } });
        setModels(r.models);
        if (r.error) setError(r.error);
        else if (!r.models.length) setError("The endpoint returned no models.");
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={existing ? `Edit ${existing.name}` : "Add AI provider"}
      footer={
        <>
          <Button onClick={() => run("test")} loading={busy === "test"} disabled={!form.baseUrl || !form.model}>Test connection</Button>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => run("save")} loading={busy === "save"} disabled={!form.name || !form.baseUrl || !form.model}>Save</Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {!existing && (
          <div className="sm:col-span-2">
            <Field label="Start from a preset">
              <Select defaultValue="" onChange={(e) => applyPreset(e.target.value)}>
                <option value="" disabled>Choose…</option>
                {PRESETS.map((p) => <option key={p.label}>{p.label}</option>)}
              </Select>
            </Field>
          </div>
        )}
        {note && <p className="rounded-md border border-border bg-panel px-3 py-2 text-xs text-muted sm:col-span-2">{note}</p>}
        <Field label="Name">
          <Input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Local Qwen Coder" />
        </Field>
        <Field label="Base URL" hint="OpenAI-compatible API root (ends in /v1 for most servers)">
          <Input value={form.baseUrl} onChange={(e) => set("baseUrl", e.target.value)} placeholder="http://ollama:11434/v1" className="font-mono" />
        </Field>
        <Field label="API key" hint={existing?.hasApiKey ? "Leave blank to keep the saved key" : "Optional for local servers"}>
          <Input type="password" value={form.apiKey} onChange={(e) => set("apiKey", e.target.value)} autoComplete="off" placeholder={existing?.hasApiKey ? "••••••••" : ""} />
        </Field>
        <Field label="Model">
          <div className="flex gap-2">
            <Input value={form.model} onChange={(e) => set("model", e.target.value)} list="model-options" className="font-mono" placeholder="model id" />
            <Button onClick={() => run("models")} loading={busy === "models"} disabled={!form.baseUrl}>Fetch</Button>
            <datalist id="model-options">{models.map((m) => <option key={m} value={m} />)}</datalist>
          </div>
        </Field>
        <Field label="Context window (tokens)" hint="Diffs are split into batches that fit this size">
          <Input type="number" min={2000} value={form.maxContextTokens} onChange={(e) => set("maxContextTokens", Number(e.target.value))} />
        </Field>
        <Field label="Temperature" hint="Low values give steadier reviews">
          <Input type="number" min={0} max={2} step={0.05} value={form.temperature} onChange={(e) => set("temperature", Number(e.target.value))} />
        </Field>
        <div className="space-y-2 sm:col-span-2">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.jsonMode} onChange={(e) => set("jsonMode", e.target.checked)} />
            Request JSON mode (<code className="text-xs">response_format: json_object</code>). Disable if the server rejects it.
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.isLocal} onChange={(e) => set("isLocal", e.target.checked)} />
            Runs inside our network. When this is off, secrets are masked before code is sent.
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.isDefault} onChange={(e) => set("isDefault", e.target.checked)} />
            Default provider for new reviews
          </label>
        </div>
      </div>
      <div className="mt-4 space-y-2">
        {testResult && (
          <div className={`rounded-md border px-3 py-2 font-mono text-xs whitespace-pre-wrap ${testResult.startsWith("✓") ? "border-ok/40 text-ok" : "border-danger/40 text-danger"}`}>{testResult}</div>
        )}
        <ErrorNote error={error} />
      </div>
    </Modal>
  );
}
