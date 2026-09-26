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
            {review.status === "running" && <p className="text-sm text-muted">Review in progress: {review.progress.current ?? "starting"} ({review.progress.done}/{review.progress.total || "?"})</p>}
            {review.status === "failed" && <ErrorNote error={review.error} />}
            {review.summary && <Markdown>{review.summary}</Markdown>}
            {review.status === "completed" && (
              <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3 text-xs text-muted">
                {counts.map(({ s, n }) => <Badge key={s} tone={n ? SEVERITY_TONE[s] : "muted"}>{n} {s}</Badge>)}
                <span className="ml-auto font-mono">
                  {review.model} · {(review.promptTokens + review.completionTokens).toLocaleString()} tokens ({review.promptTokens.toLocaleString()} in / {review.completionTokens.toLocaleString()} out)
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
          </div>
        </Card>
      )}
      <Card title="Description">
        <div className="p-4 text-sm">{pr.body ? <Markdown>{pr.body}</Markdown> : <span className="text-muted">No description provided.</span>}</div>
      </Card>
    </div>
  );
}
