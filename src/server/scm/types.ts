export type ScmProviderType = "github" | "azure_devops";

export interface ScmViewer {
  login: string;
  name: string | null;
  avatarUrl: string | null;
}

export interface ScmRepo {
  owner: string; // GitHub owner/org; Azure DevOps project
  name: string;
  fullName: string;
  private: boolean;
  description: string | null;
  defaultBranch: string;
  updatedAt: string | null;
  url: string;
}

export interface ScmPullSummary {
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
}

export interface ScmPullDetail extends ScmPullSummary {
  body: string;
  headSha: string;
  baseSha: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  commits: number;
  mergeable: boolean | null;
}

export interface ScmFile {
  path: string;
  previousPath: string | null;
  status: "added" | "modified" | "removed" | "renamed" | "copied" | "changed" | "unchanged";
  additions: number;
  deletions: number;
  /** Unified hunks. Missing for binary files or diffs the host considers too large. */
  patch: string | null;
  sha: string | null;
}

export interface ReviewCommentInput {
  path: string;
  line: number;
  startLine?: number;
  body: string;
}

export type ReviewEvent = "approve" | "comment" | "request_changes";

export interface SubmitReviewInput {
  commitSha: string;
  body: string;
  event: ReviewEvent;
  comments: ReviewCommentInput[];
}

/** Implemented once per code host; the rest of the app only talks to this interface. */
export interface ScmProvider {
  getViewer(): Promise<ScmViewer>;
  listRepos(): Promise<ScmRepo[]>;
  listPulls(owner: string, repo: string, state: "open" | "closed" | "all"): Promise<ScmPullSummary[]>;
  /** PRs where the connected account's review is requested. */
  listReviewRequests(): Promise<ScmPullSummary[]>;
  getPull(owner: string, repo: string, number: number): Promise<ScmPullDetail>;
  getFiles(owner: string, repo: string, number: number): Promise<ScmFile[]>;
  getFileContent(owner: string, repo: string, path: string, ref: string): Promise<string | null>;
  submitReview(owner: string, repo: string, number: number, input: SubmitReviewInput): Promise<{ url: string }>;
}
