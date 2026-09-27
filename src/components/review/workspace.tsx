"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { api } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { Badge, Button, ErrorNote, Kbd, Modal, Select, Spinner, timeAgo } from "../ui";
import { FileTree } from "./file-tree";
import { DiffView, linesFromPatch, type ViewMode } from "./diff-view";
import { CommentComposer, FindingCard } from "./finding-card";
import { RunDialog, type RunOptions } from "./run-dialog";
import { SubmitDialog } from "./submit-dialog";
import { Overview } from "./overview";
import { FindingsList } from "./findings-list";
import { ChatPanel } from "./chat-panel";
import { HOST_LABEL, type HostType } from "@/lib/hosts";
import type { DraftComment, Finding, FindingPatch, PrDetail, PrFile, Review, ReviewListItem } from "./types";

type PrData = { pr: PrDetail; files: PrFile[]; viewed: { path: string; sha: string }[]; reviews: ReviewListItem[]; host: HostType; canReview: boolean; canPost: boolean };
type Tab = "overview" | "files" | "findings" | "chat";

function readPref<T extends string>(key: string, fallback: T): T {
  try {
    return (localStorage.getItem(key) as T) || fallback;
  } catch {
    return fallback;
  }
}

export function ReviewWorkspace({ connId, owner, repo, number }: { connId: string; owner: string; repo: string; number: string }) {
  const base = `/api/c/${connId}/pulls/${owner}/${repo}/${number}`;
  const prQ = useApi<PrData>(base);
  const pr = prQ.data?.pr;
  const files = useMemo(() => prQ.data?.files ?? [], [prQ.data]);

  const [tab, setTab] = useState<Tab>("files");
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [mode, setMode] = useState<ViewMode>("unified");
  const [viewed, setViewed] = useState<Map<string, string>>(new Map());
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [reviewData, setReviewData] = useState<{ review: Review; findings: Finding[] } | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [editRequest, setEditRequest] = useState(0);
  const [draft, setDraft] = useState<DraftComment | null>(null);
  const [fullContent, setFullContent] = useState<Map<string, string | null>>(new Map());
  const [dialog, setDialog] = useState<"run" | "submit" | "help" | null>(null);
  const mainRef = useRef<HTMLDivElement>(null);

  useEffect(() => setMode(readPref<ViewMode>("diff.mode", "unified")), []);
  const changeMode = (m: ViewMode) => {
    setMode(m);
    try {
      localStorage.setItem("diff.mode", m);
    } catch {}
  };

  // Initialise from loaded PR data.
  useEffect(() => {
    if (!prQ.data) return;
    setViewed(new Map(prQ.data.viewed.map((v) => [v.path, v.sha])));
    setSelectedPath((cur) => cur ?? prQ.data!.files[0]?.path ?? null);
    setReviewId((cur) => cur ?? prQ.data!.reviews[0]?.id ?? null);
    if (!prQ.data.reviews.length) setTab("overview");
  }, [prQ.data]);

  // Load the selected review and poll while it runs.
  useEffect(() => {
    if (!reviewId) {
      setReviewData(null);
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const data = await api<{ review: Review; findings: Finding[] }>(`/api/reviews/${reviewId}`);
        if (cancelled) return;
        setReviewData(data);
        setReviewError(null);
        if (data.review.status === "running" || data.review.status === "queued") timer = setTimeout(load, 2000);
      } catch (err) {
        if (!cancelled) setReviewError((err as Error).message);
      }
    };
    load();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [reviewId]);

  const review = reviewData?.review ?? null;
  const findings = useMemo(() => reviewData?.findings ?? [], [reviewData]);

  const findingsByPath = useMemo(() => {
    const m = new Map<string, Finding[]>();
    for (const f of findings) m.set(f.path, [...(m.get(f.path) ?? []), f]);
    return m;
  }, [findings]);

  // Navigation order: file order in the PR, then line.
  const navOrder = useMemo(() => {
    const idx = new Map(files.map((f, i) => [f.path, i]));
    return findings
      .filter((f) => f.state !== "dismissed")
      .sort((a, b) => (idx.get(a.path) ?? 1e9) - (idx.get(b.path) ?? 1e9) || (a.line ?? 0) - (b.line ?? 0));
  }, [findings, files]);

  const selectedFile = files.find((f) => f.path === selectedPath) ?? null;
  const isViewed = useCallback((f: PrFile) => Boolean(f.sha && viewed.get(f.path) === f.sha), [viewed]);

  // Lazy-load full file content for the "full" view.
  useEffect(() => {
    if (mode !== "full" || !selectedFile || !pr || fullContent.has(selectedFile.path) || selectedFile.status === "removed") return;
    const path = selectedFile.path;
    api<{ content: string }>(`${base}/content?path=${encodeURIComponent(path)}&ref=${pr.headSha}`)
      .then((r) => setFullContent((m) => new Map(m).set(path, r.content)))
      .catch(() => setFullContent((m) => new Map(m).set(path, "")));
  }, [mode, selectedFile, pr, base, fullContent]);

  const openFile = useCallback((path: string) => {
    setSelectedPath(path);
    setTab("files");
    setDraft(null);
    mainRef.current?.scrollTo({ top: 0 });
  }, []);

  const toggleViewed = useCallback(
    async (f: PrFile) => {
      if (!f.sha) return;
      const next = !isViewed(f);
      setViewed((m) => {
        const n = new Map(m);
        if (next) n.set(f.path, f.sha!);
        else n.delete(f.path);
        return n;
      });
      await api(`${base}/viewed`, { method: "PUT", body: { path: f.path, sha: f.sha, viewed: next } }).catch(() => {});
    },
    [base, isViewed],
  );

  const updateFinding = useCallback(async (id: string, patch: FindingPatch) => {
    let prev: Finding | undefined;
    setReviewData((d) => {
      if (!d) return d;
      prev = d.findings.find((f) => f.id === id);
      return { ...d, findings: d.findings.map((f) => (f.id === id ? { ...f, ...patch } : f)) };
    });
    try {
      await api(`/api/findings/${id}`, { method: "PATCH", body: patch });
    } catch (err) {
      setReviewData((d) => (d && prev ? { ...d, findings: d.findings.map((f) => (f.id === id ? prev! : f)) } : d));
      alert((err as Error).message);
    }
  }, []);

  const deleteFinding = useCallback(async (id: string) => {
    await api(`/api/findings/${id}`, { method: "DELETE" });
    setReviewData((d) => (d ? { ...d, findings: d.findings.filter((f) => f.id !== id) } : d));
  }, []);

  const ensureReview = async (): Promise<string> => {
    if (reviewId) return reviewId;
    const { id } = await api<{ id: string }>(`${base}/reviews`, { body: { mode: "manual" } });
    const data = await api<{ review: Review; findings: Finding[] }>(`/api/reviews/${id}`);
    setReviewData(data);
    setReviewId(id);
    prQ.setData((d) => (d ? { ...d, reviews: [{ ...data.review }, ...d.reviews] } : d));
    return id;
  };

  const addComment = async (body: string, suggestion: string | null) => {
    if (!draft) return;
    const id = await ensureReview();
    const { finding } = await api<{ finding: Finding }>(`/api/reviews/${id}/findings`, {
      body: { path: draft.path, line: draft.line, endLine: draft.endLine ?? null, body, suggestion },
    });
    setReviewData((d) => (d ? { ...d, findings: [...d.findings, finding] } : d));
    setDraft(null);
  };

  const onLineClick = useCallback(
    (line: number, shift: boolean) => {
      if (!selectedPath) return;
      setDraft((d) => {
        if (shift && d && d.path === selectedPath) {
          const [a, b] = [Math.min(d.line, line), Math.max(d.line, line)];
          return { path: selectedPath, line: a, endLine: b > a ? b : undefined };
        }
        return { path: selectedPath, line };
      });
    },
    [selectedPath],
  );

  const startReview = async (o: RunOptions) => {
    const { id } = await api<{ id: string }>(`${base}/reviews`, { body: { mode: "ai", ...o } });
    setDialog(null);
    setReviewId(id);
    setTab("overview");
    prQ.setData((d) =>
      d ? { ...d, reviews: [{ id, status: "queued", model: "…", headSha: d.pr.headSha, createdAt: new Date().toISOString(), postedAt: null }, ...d.reviews] } : d,
    );
  };

  const submitReview = async (o: { event: string; summary: string; attribution: boolean }) => {
    const res = await api<{ url: string }>(`/api/reviews/${reviewId}/submit`, { body: o });
    const data = await api<{ review: Review; findings: Finding[] }>(`/api/reviews/${reviewId}`);
    setReviewData(data);
    return res.url;
  };

  const focusFinding = useCallback(
    (f: Finding) => {
      setFocusedId(f.id);
      if (f.path !== selectedPath) openFile(f.path);
      setTab("files");
      setTimeout(() => document.getElementById(`finding-${f.id}`)?.scrollIntoView({ block: "center", behavior: "smooth" }), 50);
    },
    [openFile, selectedPath],
  );

  // Keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (dialog || e.metaKey || e.ctrlKey || e.altKey || t.closest("input, textarea, select, [contenteditable]")) return;
      const focused = findings.find((f) => f.id === focusedId);
      const fileIdx = files.findIndex((f) => f.path === selectedPath);
      const navIdx = navOrder.findIndex((f) => f.id === focusedId);
      switch (e.key) {
        case "j":
        case "k": {
          if (!navOrder.length) return;
          const next = e.key === "j" ? (navIdx + 1) % navOrder.length : (navIdx - 1 + navOrder.length) % navOrder.length;
          focusFinding(navOrder[navIdx < 0 ? 0 : next]);
          break;
        }
        case "n":
        case "p": {
          const next = files[e.key === "n" ? fileIdx + 1 : fileIdx - 1];
          if (next) openFile(next.path);
          break;
        }
        case "a":
          if (focused && focused.state !== "posted") updateFinding(focused.id, { state: "accepted" });
          break;
        case "d":
          if (focused && focused.source === "ai" && focused.state !== "posted") updateFinding(focused.id, { state: "dismissed" });
          break;
        case "u":
          if (focused && focused.state !== "posted") updateFinding(focused.id, { state: "pending" });
          break;
        case "e":
          if (focused) setEditRequest((n) => n + 1);
          break;
        case "v":
          if (selectedFile) toggleViewed(selectedFile);
          break;
        case "1":
          setTab("overview");
          break;
        case "2":
          setTab("files");
          break;
        case "3":
          setTab("findings");
          break;
        case "4":
          setTab("chat");
          break;
        case "?":
          setDialog("help");
          break;
        default:
          return;
      }
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dialog, findings, focusedId, files, selectedPath, navOrder, selectedFile, focusFinding, openFile, updateFinding, toggleViewed]);

  if (prQ.loading && !prQ.data) return <div className="flex flex-1 items-center justify-center"><Spinner className="h-6 w-6" /></div>;
  if (prQ.error || !pr) return <div className="p-6"><ErrorNote error={prQ.error ?? "Pull request not found"} /></div>;

  const running = review?.status === "running" || review?.status === "queued";
  // The newest completed AI review at an older commit: the base for an incremental run.
  const previousReview = prQ.data!.reviews.find((r) => r.status === "completed" && r.model !== "manual" && r.headSha !== pr.headSha) ?? null;
  const acceptedCount = findings.filter((f) => f.state === "accepted").length;
  const stale = review && review.headSha !== pr.headSha;
  const skipped = new Set(review?.skippedFiles ?? []);
  const fileFindings = selectedFile ? (findingsByPath.get(selectedFile.path) ?? []) : [];
  const outsideDiff = fileFindings.filter((f) => !f.inDiff || !f.line);

  const renderFinding = (f: Finding) => (
    <FindingCard key={f.id} finding={f} focused={f.id === focusedId} onFocus={setFocusedId} onUpdate={updateFinding} onDelete={deleteFinding} editRequest={editRequest} />
  );

  return (
    <div className="flex h-[calc(100vh-3rem)] flex-col">
      {/* PR header */}
      <div className="shrink-0 border-b border-border bg-bg px-4 pt-3">
        <div className="text-xs text-muted">
          <Link href="/repos" className="hover:text-fg">Repositories</Link> / <Link href={`/c/${connId}/${owner}/${repo}`} className="hover:text-fg">{decodeURIComponent(owner)}/{decodeURIComponent(repo)}</Link>
        </div>
        <div className="mt-1 flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-semibold">
              {pr.title} <span className="font-normal text-muted">#{pr.number}</span>
            </h1>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
              <Badge tone={pr.state === "open" ? (pr.draft ? "muted" : "ok") : pr.state === "merged" ? "accent" : "danger"}>{pr.draft && pr.state === "open" ? "draft" : pr.state}</Badge>
              <span><b className="text-fg">{pr.author}</b> wants to merge {pr.commits} commit{pr.commits === 1 ? "" : "s"}</span>
              <span className="font-mono">{pr.sourceBranch} → {pr.targetBranch}</span>
              <span>{pr.changedFiles} files</span>
              <span className="font-mono text-ok">+{pr.additions}</span>
              <span className="font-mono text-danger">-{pr.deletions}</span>
              {pr.mergeable === false && <Badge tone="danger">merge conflicts</Badge>}
              <a href={pr.url} target="_blank" rel="noreferrer" className="text-accent hover:underline">Open on {HOST_LABEL[prQ.data!.host]} ↗</a>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {prQ.data!.reviews.length > 0 && (
              <Select className="h-8 w-56 text-xs" value={reviewId ?? ""} onChange={(e) => setReviewId(e.target.value)} title="Review history">
                {prQ.data!.reviews.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.model === "manual" ? "Manual" : r.model} · {timeAgo(r.createdAt)}{r.postedAt ? " · posted" : ""}{r.status !== "completed" ? ` · ${r.status}` : ""}
                  </option>
                ))}
              </Select>
            )}
            {prQ.data!.canReview && <Button onClick={() => setDialog("run")} disabled={running}>{running ? <><Spinner className="h-3.5 w-3.5" /> {review?.status === "queued" ? "Queued…" : "Reviewing…"}</> : "✦ Run AI review"}</Button>}
            {review?.postedUrl && (
              <a href={review.postedUrl} target="_blank" rel="noreferrer" className="whitespace-nowrap text-xs text-ok hover:underline" title={`Posted ${timeAgo(review.postedAt)}`}>✓ Posted ↗</a>
            )}
            {prQ.data!.canPost && <Button variant="primary" onClick={() => setDialog("submit")} disabled={!review || running}>
              Submit review{acceptedCount > 0 && <span className="rounded-full bg-accent-fg/20 px-1.5 text-xs">{acceptedCount}</span>}
            </Button>}
            <button className="text-muted hover:text-fg" onClick={() => setDialog("help")} title="Keyboard shortcuts (?)"><Kbd>?</Kbd></button>
          </div>
        </div>
        {running && review && (
          <div className="mt-2 flex items-center gap-2 text-xs text-muted">
            <div className="h-1 flex-1 overflow-hidden rounded-full bg-panel-2">
              <div className="h-full bg-accent transition-all" style={{ width: `${review.progress.total ? (review.progress.done / review.progress.total) * 100 : 3}%` }} />
            </div>
            <span className="max-w-md truncate font-mono">{review.progress.current ?? "Preparing"} ({review.progress.done}/{review.progress.total || "?"})</span>
          </div>
        )}
        {stale && !running && (
          <div className="mt-2 rounded-md border border-warn/40 bg-warn/10 px-3 py-1.5 text-xs text-warn">
            New commits were pushed after this review ran ({review.headSha.slice(0, 7)} → {pr.headSha.slice(0, 7)}). Run the review again to cover the latest changes.
          </div>
        )}
        <ErrorNote error={reviewError} />
        <nav className="mt-2 flex gap-1 text-sm">
          {([
            ["overview", "Overview"],
            ["files", `Files ${files.length}`],
            ["findings", `Findings ${findings.filter((f) => f.state !== "dismissed").length}`],
            ["chat", "Ask"],
          ] as const).map(([k, label]) => (
            <button key={k} onClick={() => setTab(k)} className={clsx("border-b-2 px-3 py-2", tab === k ? "border-accent font-medium" : "border-transparent text-muted hover:text-fg")}>{label}</button>
          ))}
        </nav>
      </div>

      <div className="flex min-h-0 flex-1">
        {tab === "files" && (
          <aside className="w-72 shrink-0 border-r border-border bg-panel">
            <FileTree files={files} selected={selectedPath} onSelect={openFile} findingsByPath={findingsByPath} isViewed={isViewed} onToggleViewed={toggleViewed} skipped={skipped} />
          </aside>
        )}
        <div ref={mainRef} className="min-w-0 flex-1 overflow-y-auto">
          {tab === "overview" && <Overview pr={pr} review={review} findings={findings} onRun={() => setDialog("run")} />}
          {tab === "findings" && <FindingsList findings={findings} onOpen={focusFinding} />}
          {tab === "chat" && <ChatPanel base={base} headSha={pr.headSha} focusPath={selectedPath} />}
          {tab === "files" && selectedFile && (
            <div>
              <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b border-border bg-panel px-4 py-2">
                <span className="min-w-0 truncate font-mono text-[13px] font-medium" title={selectedFile.path}>
                  {selectedFile.previousPath && selectedFile.previousPath !== selectedFile.path && <span className="text-muted">{selectedFile.previousPath} → </span>}
                  {selectedFile.path}
                </span>
                <span className="font-mono text-xs text-ok">+{selectedFile.additions}</span>
                <span className="font-mono text-xs text-danger">-{selectedFile.deletions}</span>
                {skipped.has(selectedFile.path) && <Badge tone="muted">not reviewed by AI</Badge>}
                <div className="ml-auto flex items-center gap-2">
                  <div className="flex rounded-md border border-border text-xs">
                    {(["unified", "split", "full"] as const).map((m) => (
                      <button key={m} onClick={() => changeMode(m)} className={clsx("px-2.5 py-1 capitalize first:rounded-l-md last:rounded-r-md", mode === m ? "bg-panel-2 font-medium" : "text-muted hover:text-fg")}>{m === "full" ? "Full file" : m}</button>
                    ))}
                  </div>
                  <label className="flex items-center gap-1 text-xs text-muted">
                    <input type="checkbox" checked={isViewed(selectedFile)} onChange={() => toggleViewed(selectedFile)} /> Viewed
                  </label>
                  <Button size="sm" variant="ghost" onClick={() => { const i = files.indexOf(selectedFile); if (i > 0) openFile(files[i - 1].path); }} title="Previous file (p)">↑</Button>
                  <Button size="sm" variant="ghost" onClick={() => { const i = files.indexOf(selectedFile); if (i < files.length - 1) openFile(files[i + 1].path); }} title="Next file (n)">↓</Button>
                </div>
              </div>
              {outsideDiff.length > 0 && mode !== "full" && (
                <div className="space-y-2 border-b border-border bg-panel px-4 py-3">
                  <div className="text-xs font-medium text-muted">Findings outside the changed lines. These will go in the review summary.</div>
                  <div className="max-w-4xl space-y-2">{outsideDiff.map(renderFinding)}</div>
                </div>
              )}
              <DiffView
                file={selectedFile}
                mode={mode}
                findings={fileFindings}
                draft={draft}
                fullContent={fullContent.get(selectedFile.path) ?? null}
                onLineClick={onLineClick}
                renderFinding={renderFinding}
                renderDraft={() => (
                  <CommentComposer
                    key={`${draft?.line}-${draft?.endLine}`}
                    label={draft?.endLine ? `Comment on lines ${draft.line}–${draft.endLine}` : `Comment on line ${draft?.line}`}
                    initialSuggestion={linesFromPatch(selectedFile.patch, draft!.line, draft!.endLine ?? draft!.line)}
                    onSubmit={addComment}
                    onCancel={() => setDraft(null)}
                  />
                )}
              />
            </div>
          )}
          {tab === "files" && !selectedFile && <div className="p-8 text-center text-muted">No files changed.</div>}
        </div>
      </div>

      <RunDialog
        open={dialog === "run"}
        onClose={() => setDialog(null)}
        onRun={startReview}
        connId={connId}
        owner={owner}
        repo={repo}
        baseSha={pr.baseSha}
        headSha={pr.headSha}
        previousReview={previousReview}
        stats={{ files: files.length, additions: pr.additions, deletions: pr.deletions }}
      />
      {review && (
        <SubmitDialog host={prQ.data!.host} open={dialog === "submit"} onClose={() => setDialog(null)} review={review} findings={findings} prMoved={Boolean(stale)} onSubmit={submitReview} />
      )}
      <Modal open={dialog === "help"} onClose={() => setDialog(null)} title="Keyboard shortcuts">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          {[
            ["j / k", "Next / previous finding"],
            ["n / p", "Next / previous file"],
            ["a", "Accept focused finding"],
            ["d", "Dismiss focused finding"],
            ["u", "Reset focused finding to pending"],
            ["e", "Edit focused finding"],
            ["v", "Toggle file viewed"],
            ["1 / 2 / 3 / 4", "Overview / Files / Findings / Ask"],
            ["+ on a line", "Comment (Shift+click to select a range)"],
            ["?", "This help"],
          ].map(([k, d]) => (
            <div key={k} className="contents">
              <dt><Kbd>{k}</Kbd></dt>
              <dd className="text-muted">{d}</dd>
            </div>
          ))}
        </dl>
      </Modal>
    </div>
  );
}
