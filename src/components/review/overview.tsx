"use client";

import { Badge, Button, Card, Empty, ErrorNote } from "../ui";
import { Markdown } from "../markdown";
import { SEVERITIES, SEVERITY_TONE, type Finding, type PrDetail, type Review } from "./types";

export function Overview({ pr, review, findings, onRun }: { pr: PrDetail; review: Review | null; findings: Finding[]; onRun: () => void }) {
  const counts = SEVERITIES.map((s) => ({ s, n: findings.filter((f) => f.severity === s && f.source === "ai").length }));
  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4">
      {!review ? (
        <Card>
          <Empty title="No AI review yet" action={<Button variant="primary" onClick={onRun}>Run AI review</Button>}>
            Run a review to get a summary, a risk rating and line-level findings. You decide what gets posted.
          </Empty>
        </Card>
      ) : review.model === "manual" ? null : (
        <Card
          title="AI summary"
          actions={
            review.status === "completed" && (
              <>
                {review.riskLevel && <Badge tone={review.riskLevel === "high" ? "danger" : review.riskLevel === "medium" ? "warn" : "ok"}>{review.riskLevel} risk</Badge>}
                {review.verdict && <Badge tone={review.verdict === "request_changes" ? "danger" : review.verdict === "approve" ? "ok" : "muted"}>suggests: {review.verdict.replace("_", " ")}</Badge>}
              </>
            )
          }
        >
          <div className="space-y-3 p-4">
            {review.status === "queued" && <p className="text-sm text-muted">Queued: {review.progress.current ?? "waiting for a worker"}.</p>}
            {review.status === "queued" && review.error && <p className="text-xs text-warn">{review.error}</p>}
            {review.status === "running" && <p className="text-sm text-muted">Review in progress: {review.progress.current ?? "starting"} ({review.progress.done}/{review.progress.total || "?"})</p>}
            {(review.trigger === "webhook" || review.baseReviewId) && (
              <div className="flex flex-wrap gap-2 text-xs">
                {review.trigger === "webhook" && <Badge tone="accent">automatic draft</Badge>}
                {review.baseReviewId && (
                  <Badge tone="muted">incremental · {review.unchangedFiles.length} unchanged file{review.unchangedFiles.length === 1 ? "" : "s"} carried over</Badge>
                )}
              </div>
            )}
            {review.status === "failed" && <ErrorNote error={review.error} />}
            {review.summary && <Markdown>{review.summary}</Markdown>}
            {review.status === "completed" && (
              <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3 text-xs text-muted">
                {counts.map(({ s, n }) => <Badge key={s} tone={n ? SEVERITY_TONE[s] : "muted"}>{n} {s}</Badge>)}
                <span className="ml-auto font-mono">
                  {review.model} · {(review.promptTokens + review.completionTokens).toLocaleString()} tokens ({review.promptTokens.toLocaleString()} in / {review.completionTokens.toLocaleString()} out)
                  {review.costUsd > 0 && <> · ${review.costUsd < 0.01 ? review.costUsd.toFixed(4) : review.costUsd.toFixed(2)}</>}
                </span>
              </div>
            )}
            {review.status === "completed" && review.error && <ErrorNote error={review.error} />}
            {review.skippedFiles.length > 0 && (
              <details className="text-xs text-muted">
                <summary className="cursor-pointer">{review.skippedFiles.length} files skipped (lockfiles, generated, binary, deleted)</summary>
                <ul className="mt-1 list-inside list-disc font-mono">{review.skippedFiles.map((p) => <li key={p}>{p}</li>)}</ul>
              </details>
            )}
            {review.instructions && <p className="text-xs text-muted">Focus: {review.instructions}</p>}
            {review.minSeverity && <p className="text-xs text-muted">Only findings of {review.minSeverity} severity and above were kept.</p>}
            {review.repoRules && (
              <details className="text-xs text-muted">
                <summary className="cursor-pointer">
                  Repository rules applied from <code>{review.repoRules.path}</code> at <code>{review.repoRules.ref.slice(0, 7)}</code>
                  {review.repoRules.warnings.length > 0 && <span className="text-warn"> · {review.repoRules.warnings.length} warning{review.repoRules.warnings.length === 1 ? "" : "s"}</span>}
                </summary>
                <div className="mt-1 space-y-1 pl-3">
                  {review.repoRules.instructions && <pre className="whitespace-pre-wrap font-sans">{review.repoRules.instructions}</pre>}
                  {review.repoRules.ignore.length > 0 && <p>Skipped: <span className="font-mono">{review.repoRules.ignore.join(", ")}</span></p>}
                  {review.repoRules.pathInstructions.map((r) => <p key={r.path}><span className="font-mono">{r.path}</span>: {r.instructions}</p>)}
                  {review.repoRules.warnings.map((w) => <p key={w} className="text-warn">{w}</p>)}
                </div>
              </details>
            )}
          </div>
        </Card>
      )}
      <Card title="Description">
        <div className="p-4 text-sm">{pr.body ? <Markdown>{pr.body}</Markdown> : <span className="text-muted">No description provided.</span>}</div>
      </Card>
    </div>
  );
}
