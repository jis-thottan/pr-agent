"use client";

import { useEffect, useState } from "react";
import clsx from "clsx";
import { Button, ErrorNote, Modal, Textarea } from "../ui";
import { Markdown } from "../markdown";
import { HOST_LABEL, type HostType } from "@/lib/hosts";
import type { Finding, Review } from "./types";

type Event = "comment" | "approve" | "request_changes";

const EVENTS: Record<HostType, { value: Event; label: string; hint: string }[]> = {
  github: [
    { value: "comment", label: "Comment", hint: "Post feedback without approving or blocking." },
    { value: "approve", label: "Approve", hint: "Approve the changes." },
    { value: "request_changes", label: "Request changes", hint: "The PR must be updated before it can merge." },
  ],
  azure_devops: [
    { value: "comment", label: "Comment", hint: "Post comment threads without changing your vote." },
    { value: "approve", label: "Approve", hint: "Post the comments and vote Approve." },
    { value: "request_changes", label: "Wait for author", hint: "Post the comments and vote Wait for author. The summary thread stays active." },
  ],
};

export function SubmitDialog({ host, open, onClose, review, findings, prMoved, onSubmit }: {
  host: HostType;
  open: boolean;
  onClose: () => void;
  review: Review;
  findings: Finding[];
  prMoved: boolean;
  onSubmit: (o: { event: Event; summary: string; attribution: boolean }) => Promise<string>;
}) {
  const [event, setEvent] = useState<Event>("comment");
  const [summary, setSummary] = useState("");
  const [attribution, setAttribution] = useState(true);
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [postedUrl, setPostedUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setEvent(review.verdict ?? "comment");
    setSummary(review.summary ?? "");
    setPostedUrl(null);
    setError(null);
  }, [open, review.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const events = EVENTS[host];
  const label = HOST_LABEL[host];
  const accepted = findings.filter((f) => f.state === "accepted");
  const inline = accepted.filter((f) => f.inDiff && f.line).length;
  const general = accepted.length - inline;
  const pending = findings.filter((f) => f.state === "pending").length;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      setPostedUrl(await onSubmit({ event, summary, attribution }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (postedUrl) {
    return (
      <Modal open={open} onClose={onClose} title="Review posted" footer={<><Button onClick={onClose}>Close</Button><a href={postedUrl} target="_blank" rel="noreferrer"><Button variant="primary">Open on {label} ↗</Button></a></>}>
        <p className="text-sm">Your review is on the pull request with {inline} inline comment{inline === 1 ? "" : "s"}.</p>
      </Modal>
    );
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Submit review"
      wide
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant={event === "request_changes" ? "danger" : event === "approve" ? "success" : "primary"} onClick={submit} loading={busy}>Submit: {events.find((e) => e.value === event)?.label}</Button></>}
    >
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-2">
          <Stat n={inline} label="inline comments" />
          <Stat n={general} label="in summary (outside diff)" />
          <Stat n={pending} label="pending (won't be posted)" tone={pending ? "warn" : undefined} />
        </div>
        {review.postedAt && (
          <p className="rounded-md border border-border bg-panel px-3 py-2 text-xs text-muted">
            This review was already posted. Submitting again posts a new {host === "github" ? "GitHub review" : "set of comment threads"} that contains only the findings accepted since then.
          </p>
        )}
        {prMoved && (
          <p className="rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">
            New commits were pushed after this review ran. Comments stay attached to the {host === "github" ? "commit" : "iteration"} that was reviewed, and {label} marks them outdated where the code changed.
          </p>
        )}
        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className="text-sm font-medium">Summary comment</span>
            <button className="text-xs text-accent hover:underline" onClick={() => setPreview(!preview)}>{preview ? "Edit" : "Preview"}</button>
          </div>
          {preview ? (
            <div className="min-h-32 rounded-md border border-border p-3 text-sm"><Markdown>{summary || "_No summary_"}</Markdown></div>
          ) : (
            <Textarea rows={10} value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="Overall feedback (Markdown)" />
          )}
        </div>
        <div className="space-y-1.5">
          {events.map((e) => (
            <label key={e.value} className={clsx("flex cursor-pointer items-start gap-2 rounded-md border px-3 py-2 text-sm", event === e.value ? "border-accent bg-accent/5" : "border-border")}>
              <input type="radio" name="event" className="mt-1" checked={event === e.value} onChange={() => setEvent(e.value)} />
              <span><span className="font-medium">{e.label}</span><span className="block text-xs text-muted">{e.hint}</span></span>
            </label>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={attribution} onChange={(e) => setAttribution(e.target.checked)} />
          Add a footer saying the review was AI-assisted and checked by you
        </label>
        <ErrorNote error={error} />
      </div>
    </Modal>
  );
}

function Stat({ n, label, tone }: { n: number; label: string; tone?: "warn" }) {
  return (
    <div className="rounded-md border border-border bg-panel px-3 py-2">
      <div className={clsx("text-lg font-semibold", tone === "warn" && "text-warn")}>{n}</div>
      <div className="text-xs text-muted">{label}</div>
    </div>
  );
}
