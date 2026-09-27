"use client";

import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { api } from "@/lib/api";
import { useApi, type AiProviderInfo } from "@/lib/hooks";
import { Markdown } from "../markdown";
import { Button, ErrorNote, Select, Spinner, Textarea, timeAgo } from "../ui";

type ChatMessage = { id: string; role: "user" | "assistant"; content: string; model: string | null; headSha: string | null; createdAt: string };

const STARTERS = [
  "Summarise what this PR changes and why.",
  "What could break in production because of this change?",
  "Which parts of this change are missing tests?",
  "Explain the riskiest file in this PR.",
];

export function ChatPanel({ base, headSha, focusPath }: { base: string; headSha: string; focusPath: string | null }) {
  const chat = useApi<{ messages: ChatMessage[] }>(`${base}/chat`);
  const providers = useApi<{ providers: AiProviderInfo[] }>("/api/ai-providers");
  const [providerId, setProviderId] = useState("");
  const [question, setQuestion] = useState("");
  const [includeFile, setIncludeFile] = useState(true);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [omitted, setOmitted] = useState<string[]>([]);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const list = providers.data?.providers;
    if (!list?.length || list.some((p) => p.id === providerId)) return;
    let saved: string | null = null;
    try {
      saved = localStorage.getItem("chat.provider");
    } catch {}
    setProviderId((list.find((p) => p.id === saved) ?? list.find((p) => p.isDefault) ?? list[0]).id);
  }, [providers.data, providerId]);

  const messages = chat.data?.messages ?? [];
  useEffect(() => endRef.current?.scrollIntoView({ block: "end" }), [messages.length, pending]);

  const ask = async (q: string) => {
    const text = q.trim();
    if (!text || pending) return;
    setPending(text);
    setQuestion("");
    setError(null);
    try {
      try {
        localStorage.setItem("chat.provider", providerId);
      } catch {}
      const res = await api<{ messages: ChatMessage[]; omitted: string[] }>(`${base}/chat`, {
        body: { providerId, question: text, focusPath: includeFile ? focusPath : null },
      });
      chat.setData((d) => ({ messages: [...(d?.messages ?? []), ...res.messages] }));
      setOmitted(res.omitted);
    } catch (err) {
      setError((err as Error).message);
      setQuestion(text);
    } finally {
      setPending(null);
    }
  };

  const clear = async () => {
    if (!confirm("Clear this conversation?")) return;
    await api(`${base}/chat`, { method: "DELETE" });
    chat.setData({ messages: [] });
    setOmitted([]);
  };

  const provider = providers.data?.providers.find((p) => p.id === providerId);

  return (
    <div className="mx-auto flex h-full max-w-4xl flex-col">
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {chat.loading && !chat.data && <div className="p-6 text-center"><Spinner /></div>}
        <ErrorNote error={chat.error} />
        {chat.data && !messages.length && !pending && (
          <div className="space-y-3 py-6 text-center">
            <p className="font-semibold">Ask about this pull request</p>
            <p className="text-sm text-muted">Answers use the diff, the description and the current review findings. The conversation is private to you.</p>
            <div className="flex flex-wrap justify-center gap-2">
              {STARTERS.map((s) => <Button key={s} size="sm" onClick={() => void ask(s)} disabled={!providerId}>{s}</Button>)}
            </div>
          </div>
        )}
        {messages.map((m) => (
          <Bubble key={m.id} role={m.role} meta={m.role === "assistant" ? `${m.model ?? ""} · ${timeAgo(m.createdAt)}${m.headSha && m.headSha !== headSha ? " · earlier commit" : ""}` : timeAgo(m.createdAt)}>
            {m.role === "assistant" ? <Markdown>{m.content}</Markdown> : <p className="whitespace-pre-wrap">{m.content}</p>}
          </Bubble>
        ))}
        {pending && (
          <>
            <Bubble role="user" meta="now"><p className="whitespace-pre-wrap">{pending}</p></Bubble>
            <Bubble role="assistant" meta={provider?.model ?? ""}><span className="flex items-center gap-2 text-muted"><Spinner className="h-3.5 w-3.5" /> Thinking…</span></Bubble>
          </>
        )}
        {omitted.length > 0 && (
          <p className="text-center text-xs text-muted">
            {omitted.length} file diff{omitted.length === 1 ? " was" : "s were"} left out to fit the model&apos;s context. Mention a file by name to bring it in.
          </p>
        )}
        <div ref={endRef} />
      </div>
      <div className="border-t border-border bg-panel p-3">
        <ErrorNote error={error} />
        <form
          className="mt-1 space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            void ask(question);
          }}
        >
          <Textarea
            rows={3}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void ask(question);
              }
            }}
            placeholder="Ask a question about the change… (⌘/Ctrl+Enter to send)"
          />
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Select className="h-7 w-64 text-xs" value={providerId} onChange={(e) => setProviderId(e.target.value)}>
              {providers.data?.providers.map((p) => <option key={p.id} value={p.id}>{p.name}: {p.model}</option>)}
            </Select>
            {focusPath && (
              <label className="flex items-center gap-1.5 text-muted" title={focusPath}>
                <input type="checkbox" checked={includeFile} onChange={(e) => setIncludeFile(e.target.checked)} />
                Include the full <span className="max-w-48 truncate font-mono">{focusPath.split("/").pop()}</span>
              </label>
            )}
            {provider && !provider.isLocal && <span className="text-warn">Sent to {new URL(provider.baseUrl).host}, secrets masked</span>}
            <span className="ml-auto flex gap-2">
              {messages.length > 0 && <Button size="sm" variant="ghost" onClick={clear} type="button">Clear</Button>}
              <Button size="sm" variant="primary" type="submit" loading={Boolean(pending)} disabled={!question.trim() || !providerId}>Ask</Button>
            </span>
          </div>
        </form>
      </div>
    </div>
  );
}

function Bubble({ role, meta, children }: { role: "user" | "assistant"; meta: string; children: React.ReactNode }) {
  return (
    <div className={clsx("flex", role === "user" ? "justify-end" : "justify-start")}>
      <div className={clsx("max-w-[85%] rounded-lg border px-3 py-2 text-sm", role === "user" ? "border-accent/40 bg-accent/10" : "border-border bg-bg")}>
        {children}
        <div className="mt-1 text-[11px] text-muted">{meta}</div>
      </div>
    </div>
  );
}
