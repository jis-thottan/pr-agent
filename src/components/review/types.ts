import type { PullSummary } from "../pr-row";

export type Severity = "critical" | "major" | "minor" | "nit";
export type Category = "bug" | "security" | "performance" | "maintainability" | "style" | "tests" | "docs";
export const SEVERITIES: Severity[] = ["critical", "major", "minor", "nit"];
export const CATEGORIES: Category[] = ["bug", "security", "performance", "maintainability", "style", "tests", "docs"];

export type PrDetail = PullSummary & {
  body: string;
  headSha: string;
  baseSha: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  commits: number;
  mergeable: boolean | null;
};

export type PrFile = {
  path: string;
  previousPath: string | null;
  status: string;
  additions: number;
  deletions: number;
  patch: string | null;
  sha: string | null;
};

export type ReviewListItem = { id: string; status: string; model: string; headSha: string; createdAt: string; postedAt: string | null };

export type Review = {
  id: string;
  status: "running" | "completed" | "failed";
  model: string;
  headSha: string;
  instructions: string | null;
  progress: { done: number; total: number; current?: string };
  summary: string | null;
  riskLevel: "low" | "medium" | "high" | null;
  verdict: "approve" | "comment" | "request_changes" | null;
  error: string | null;
  promptTokens: number;
  completionTokens: number;
  skippedFiles: string[];
  createdAt: string;
  completedAt: string | null;
  postedAt: string | null;
  postedUrl: string | null;
};

export type Finding = {
  id: string;
  reviewId: string;
  source: "ai" | "human";
  path: string;
  line: number | null;
  endLine: number | null;
  inDiff: boolean;
  severity: Severity;
  category: Category;
  title: string;
  body: string;
  suggestion: string | null;
  state: "pending" | "accepted" | "dismissed" | "posted";
};

export type FindingPatch = Partial<Pick<Finding, "state" | "title" | "body" | "suggestion" | "severity" | "category">>;

export type DraftComment = { path: string; line: number; endLine?: number };

export const SEVERITY_TONE: Record<Severity, "danger" | "warn" | "accent" | "muted"> = {
  critical: "danger",
  major: "warn",
  minor: "accent",
  nit: "muted",
};

export const SEVERITY_RANK: Record<Severity, number> = { critical: 0, major: 1, minor: 2, nit: 3 };
