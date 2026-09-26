"use client";

import Link from "next/link";
import { Badge, timeAgo } from "./ui";

export type PullSummary = {
  owner: string;
  repo: string;
  number: number;
  title: string;
  author: string;
  authorAvatar: string | null;
  state: "open" | "closed" | "merged";
  draft: boolean;
  createdAt: string;
  updatedAt: string;
  sourceBranch: string | null;
  targetBranch: string | null;
  url: string;
  labels: string[];
};

export function prHref(connId: string, p: { owner: string; repo: string; number: number }) {
  return `/c/${connId}/${encodeURIComponent(p.owner)}/${encodeURIComponent(p.repo)}/pull/${p.number}`;
}

export function PrRow({ connId, pr, showRepo }: { connId: string; pr: PullSummary; showRepo?: boolean }) {
  const stateTone = pr.state === "open" ? (pr.draft ? "muted" : "ok") : pr.state === "merged" ? "accent" : "danger";
  return (
    <li>
      <Link href={prHref(connId, pr)} className="flex items-start gap-3 px-4 py-3 hover:bg-panel">
        {pr.authorAvatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={pr.authorAvatar} alt="" className="mt-0.5 h-6 w-6 rounded-full" />
        ) : (
          <div className="mt-0.5 h-6 w-6 rounded-full bg-panel-2" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {showRepo && <span className="text-muted">{pr.owner}/{pr.repo}</span>}
            <span className="font-medium">{pr.title}</span>
            {pr.labels.slice(0, 4).map((l) => <Badge key={l} tone="muted">{l}</Badge>)}
          </div>
          <div className="mt-0.5 text-xs text-muted">
            #{pr.number} by {pr.author} · updated {timeAgo(pr.updatedAt)}
            {pr.sourceBranch && (
              <span className="font-mono"> · {pr.sourceBranch} → {pr.targetBranch}</span>
            )}
          </div>
        </div>
        <Badge tone={stateTone}>{pr.draft && pr.state === "open" ? "draft" : pr.state}</Badge>
      </Link>
    </li>
  );
}
