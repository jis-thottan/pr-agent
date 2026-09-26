"use client";

import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { Badge, Button, Input, Select, Textarea } from "../ui";
import { Markdown } from "../markdown";
import { CATEGORIES, SEVERITIES, SEVERITY_TONE, type Finding, type FindingPatch } from "./types";

export function FindingCard({
  finding,
  focused,
  onUpdate,
  onDelete,
  onFocus,
  editRequest,
}: {
  finding: Finding;
  focused: boolean;
  onUpdate: (id: string, patch: FindingPatch) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onFocus: (id: string) => void;
  /** Incremented by the "e" shortcut to open the editor on the focused card. */
  editRequest: number;
}) {
  const [editing, setEditing] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const f = finding;
  const locked = f.state === "posted";

  useEffect(() => {
    if (focused && editRequest > 0 && !locked) setEditing(true);
  }, [editRequest]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [focused]);

  if (f.state === "dismissed" && !editing) {
    return (
      <div
        id={`finding-${f.id}`}
        ref={ref}
        onClick={() => onFocus(f.id)}
        className={clsx("flex items-center gap-2 rounded-md border border-dashed border-border bg-bg px-3 py-1.5 font-sans text-xs text-muted", focused && "ring-2 ring-accent")}
      >
        <span className="line-through">{f.title}</span>
        <span className="ml-auto">dismissed</span>
        <button className="text-accent hover:underline" onClick={() => onUpdate(f.id, { state: "pending" })}>Restore</button>
      </div>
    );
  }

  return (
    <div
      id={`finding-${f.id}`}
      ref={ref}
      onClick={() => onFocus(f.id)}
      className={clsx(
        "rounded-md border bg-bg font-sans text-sm shadow-sm",
        f.state === "accepted" ? "border-ok/60 border-l-4" : f.state === "posted" ? "border-accent/50 border-l-4" : "border-border",
        focused && "ring-2 ring-accent",
      )}
    >
      {editing ? (
        <FindingEditor finding={f} onCancel={() => setEditing(false)} onSave={async (p) => { await onUpdate(f.id, p); setEditing(false); }} />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
            {f.source === "ai" ? (
              <>
                <Badge tone={SEVERITY_TONE[f.severity]}>{f.severity}</Badge>
                <Badge tone="muted">{f.category}</Badge>
              </>
            ) : (
              <Badge tone="accent">your comment</Badge>
            )}
            <span className="font-semibold">{f.source === "ai" ? f.title : ""}</span>
            {!f.inDiff && f.line && <span className="text-xs text-warn" title="This line is outside the diff. The finding will go in the review summary.">outside diff · L{f.line}</span>}
            <span className="ml-auto text-xs text-muted">
              {f.state === "accepted" && <span className="text-ok">✓ will be posted</span>}
              {f.state === "posted" && <span className="text-accent">posted</span>}
              {f.state === "pending" && f.source === "ai" && "AI suggestion"}
            </span>
          </div>
          <div className="px-3 py-2.5">
            <Markdown>{f.body}</Markdown>
            {f.suggestion && (
              <div className="mt-2">
                <div className="mb-1 text-xs font-medium text-muted">Suggested change</div>
                <pre className="overflow-x-auto rounded-md border border-ok/30 bg-add px-3 py-2 font-mono text-[12.5px] leading-5">{f.suggestion}</pre>
              </div>
            )}
          </div>
          {!locked && (
            <div className="flex flex-wrap items-center gap-2 border-t border-border bg-panel px-3 py-1.5 rounded-b-md">
              {f.state !== "accepted" ? (
                <Button size="sm" variant="success" onClick={(e) => { e.stopPropagation(); onUpdate(f.id, { state: "accepted" }); }} title="Accept (a)">Accept</Button>
              ) : (
                <Button size="sm" onClick={(e) => { e.stopPropagation(); onUpdate(f.id, { state: "pending" }); }} title="Undo (u)">Undo accept</Button>
              )}
              <Button size="sm" onClick={(e) => { e.stopPropagation(); setEditing(true); }} title="Edit (e)">Edit</Button>
              {f.source === "ai" ? (
                <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); onUpdate(f.id, { state: "dismissed" }); }} title="Dismiss (d)">Dismiss</Button>
              ) : (
                <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); if (confirm("Delete this comment?")) onDelete(f.id); }}>Delete</Button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function FindingEditor({ finding, onSave, onCancel }: { finding: Finding; onSave: (p: FindingPatch) => Promise<void>; onCancel: () => void }) {
  const [title, setTitle] = useState(finding.title);
  const [body, setBody] = useState(finding.body);
  const [severity, setSeverity] = useState(finding.severity);
  const [category, setCategory] = useState(finding.category);
  const [suggestion, setSuggestion] = useState(finding.suggestion ?? "");
  const [busy, setBusy] = useState(false);
  const isAi = finding.source === "ai";

  const save = async () => {
    setBusy(true);
    try {
      await onSave({
        body,
        suggestion: suggestion.trim() ? suggestion : null,
        ...(isAi ? { title, severity, category } : { title: body.split("\n")[0].slice(0, 120) }),
        // Editing an AI finding means the lead endorses it.
        state: "accepted",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2 p-3" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) save(); }}>
      {isAi && (
        <div className="flex gap-2">
          <Select value={severity} onChange={(e) => setSeverity(e.target.value as typeof severity)} className="w-32">
            {SEVERITIES.map((s) => <option key={s}>{s}</option>)}
          </Select>
          <Select value={category} onChange={(e) => setCategory(e.target.value as typeof category)} className="w-40">
            {CATEGORIES.map((s) => <option key={s}>{s}</option>)}
          </Select>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" />
        </div>
      )}
      <Textarea rows={Math.min(12, Math.max(3, body.split("\n").length + 1))} value={body} onChange={(e) => setBody(e.target.value)} autoFocus />
      <details open={Boolean(suggestion)}>
        <summary className="cursor-pointer text-xs text-muted">Suggested replacement code (optional; posted as a GitHub suggestion)</summary>
        <Textarea rows={Math.min(12, Math.max(2, suggestion.split("\n").length + 1))} value={suggestion} onChange={(e) => setSuggestion(e.target.value)} className="mt-1" placeholder="Replacement for the commented line(s)" />
      </details>
      <div className="flex items-center justify-end gap-2">
        <span className="mr-auto text-xs text-muted">⌘/Ctrl + Enter to save</span>
        <Button size="sm" onClick={onCancel}>Cancel</Button>
        <Button size="sm" variant="primary" onClick={save} loading={busy} disabled={!body.trim()}>Save & accept</Button>
      </div>
    </div>
  );
}

export function CommentComposer({
  label,
  initialSuggestion,
  onSubmit,
  onCancel,
}: {
  label: string;
  initialSuggestion: string;
  onSubmit: (body: string, suggestion: string | null) => Promise<void>;
  onCancel: () => void;
}) {
  const [body, setBody] = useState("");
  const [suggest, setSuggest] = useState(false);
  const [suggestion, setSuggestion] = useState(initialSuggestion);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!body.trim()) return;
    setBusy(true);
    try {
      await onSubmit(body, suggest ? suggestion : null);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div
      className="space-y-2 rounded-md border border-accent/60 bg-bg p-3 font-sans text-sm shadow-sm"
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
        if (e.key === "Escape") onCancel();
      }}
    >
      <div className="text-xs text-muted">{label}</div>
      <Textarea rows={4} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Leave a comment (Markdown supported)" autoFocus />
      <label className="flex items-center gap-2 text-xs">
        <input type="checkbox" checked={suggest} onChange={(e) => setSuggest(e.target.checked)} /> Include a code suggestion
      </label>
      {suggest && <Textarea rows={Math.max(2, suggestion.split("\n").length + 1)} value={suggestion} onChange={(e) => setSuggestion(e.target.value)} />}
      <div className="flex items-center justify-end gap-2">
        <span className="mr-auto text-xs text-muted">⌘/Ctrl + Enter to add · Esc to cancel</span>
        <Button size="sm" onClick={onCancel}>Cancel</Button>
        <Button size="sm" variant="primary" onClick={submit} loading={busy} disabled={!body.trim()}>Add comment</Button>
      </div>
    </div>
  );
}
