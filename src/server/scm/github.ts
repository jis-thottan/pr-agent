import "server-only";
import { Octokit } from "@octokit/rest";
import type {
  ScmFile,
  ScmProvider,
  ScmPullDetail,
  ScmPullSummary,
  ScmRepo,
  ScmViewer,
  SubmitReviewInput,
} from "./types";

export const GITHUB_DEFAULT_API = "https://api.github.com";

const MAX_REPOS = 1000;
const MAX_FILES = 3000; // GitHub's own limit for the PR files endpoint

type Pull = Awaited<ReturnType<Octokit["pulls"]["get"]>>["data"];
type PullListItem = Awaited<ReturnType<Octokit["pulls"]["list"]>>["data"][number];

function pullState(p: { state: string; merged_at?: string | null }): ScmPullSummary["state"] {
  if (p.merged_at) return "merged";
  return p.state === "open" ? "open" : "closed";
}

function toSummary(owner: string, repo: string, p: PullListItem | Pull): ScmPullSummary {
  return {
    owner,
    repo,
    number: p.number,
    title: p.title,
    author: p.user?.login ?? "unknown",
    authorAvatar: p.user?.avatar_url ?? null,
    state: pullState(p),
    draft: Boolean(p.draft),
    createdAt: p.created_at,
    updatedAt: p.updated_at,
    sourceBranch: p.head?.ref ?? null,
    targetBranch: p.base?.ref ?? null,
    url: p.html_url,
    labels: (p.labels ?? []).map((l) => (typeof l === "string" ? l : (l.name ?? ""))).filter(Boolean),
  };
}

export class GitHubProvider implements ScmProvider {
  private octokit: Octokit;
  /** Set for GitHub App connections: the token belongs to the installation, not a person. */
  private installation: { reviewerLogin: string | null } | null;

  /** `token` is a PAT, or an async getter for GitHub App installation tokens. */
  constructor(token: string | (() => Promise<string>), baseUrl: string = GITHUB_DEFAULT_API, opts: { installation?: { reviewerLogin: string | null } } = {}) {
    this.installation = opts.installation ?? null;
    this.octokit = new Octokit({
      auth: typeof token === "string" ? token : undefined,
      baseUrl: baseUrl.replace(/\/+$/, ""),
      userAgent: "pull-request-ai",
      request: { timeout: 30_000 },
    });
    if (typeof token !== "string") {
      this.octokit.hook.before("request", async (options) => {
        options.headers.authorization = `token ${await token()}`;
      });
    }
  }

  async getViewer(): Promise<ScmViewer> {
    if (this.installation) {
      return { login: this.installation.reviewerLogin ?? "github-app", name: null, avatarUrl: null };
    }
    const { data } = await this.octokit.users.getAuthenticated();
    return { login: data.login, name: data.name ?? null, avatarUrl: data.avatar_url ?? null };
  }

  async listRepos(): Promise<ScmRepo[]> {
    const repos: ScmRepo[] = [];
    if (this.installation) {
      for await (const { data } of this.octokit.paginate.iterator(this.octokit.apps.listReposAccessibleToInstallation, { per_page: 100 })) {
        for (const r of data) {
          repos.push({
            owner: r.owner.login,
            name: r.name,
            fullName: r.full_name,
            private: r.private,
            description: r.description ?? null,
            defaultBranch: r.default_branch,
            updatedAt: r.pushed_at ?? r.updated_at ?? null,
            url: r.html_url,
          });
        }
        if (repos.length >= MAX_REPOS) break;
      }
      return repos.sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
    }
    for await (const { data } of this.octokit.paginate.iterator(this.octokit.repos.listForAuthenticatedUser, {
      per_page: 100,
      sort: "updated",
      affiliation: "owner,collaborator,organization_member",
    })) {
      for (const r of data) {
        repos.push({
          owner: r.owner.login,
          name: r.name,
          fullName: r.full_name,
          private: r.private,
          description: r.description ?? null,
          defaultBranch: r.default_branch,
          updatedAt: r.pushed_at ?? r.updated_at ?? null,
          url: r.html_url,
        });
      }
      if (repos.length >= MAX_REPOS) break;
    }
    return repos;
  }

  async listPulls(owner: string, repo: string, state: "open" | "closed" | "all"): Promise<ScmPullSummary[]> {
    const { data } = await this.octokit.pulls.list({
      owner,
      repo,
      state,
      per_page: 100,
      sort: "updated",
      direction: "desc",
    });
    return data.map((p) => toSummary(owner, repo, p));
  }

  async listReviewRequests(): Promise<ScmPullSummary[]> {
    const { data } = await this.octokit.request("GET /search/issues", {
      // An installation token has no "@me"; use the login of the person who connected the app.
      q: `is:pr is:open archived:false review-requested:${this.installation ? (this.installation.reviewerLogin ?? "none") : "@me"}`,
      sort: "updated",
      order: "desc",
      per_page: 50,
    });
    return data.items.map((i) => {
      const [owner, repo] = i.repository_url.split("/").slice(-2);
      return {
        owner,
        repo,
        number: i.number,
        title: i.title,
        author: i.user?.login ?? "unknown",
        authorAvatar: i.user?.avatar_url ?? null,
        state: "open" as const,
        draft: Boolean(i.draft),
        createdAt: i.created_at,
        updatedAt: i.updated_at,
        sourceBranch: null,
        targetBranch: null,
        url: i.html_url,
        labels: i.labels.map((l) => l.name ?? "").filter(Boolean),
      };
    });
  }

  async getPull(owner: string, repo: string, number: number): Promise<ScmPullDetail> {
    const { data: p } = await this.octokit.pulls.get({ owner, repo, pull_number: number });
    return {
      ...toSummary(owner, repo, p),
      body: p.body ?? "",
      headSha: p.head.sha,
      baseSha: p.base.sha,
      additions: p.additions,
      deletions: p.deletions,
      changedFiles: p.changed_files,
      commits: p.commits,
      mergeable: p.mergeable ?? null,
    };
  }

  async getFiles(owner: string, repo: string, number: number): Promise<ScmFile[]> {
    const files: ScmFile[] = [];
    for await (const { data } of this.octokit.paginate.iterator(this.octokit.pulls.listFiles, {
      owner,
      repo,
      pull_number: number,
      per_page: 100,
    })) {
      for (const f of data) {
        files.push({
          path: f.filename,
          previousPath: f.previous_filename ?? null,
          status: f.status,
          additions: f.additions,
          deletions: f.deletions,
          patch: f.patch ?? null,
          sha: f.sha ?? null,
        });
      }
      if (files.length >= MAX_FILES) break;
    }
    return files;
  }

  async getFileContent(owner: string, repo: string, path: string, ref: string): Promise<string | null> {
    try {
      const { data } = await this.octokit.repos.getContent({ owner, repo, path, ref });
      if (Array.isArray(data) || data.type !== "file" || !("content" in data)) return null;
      return Buffer.from(data.content, "base64").toString("utf8");
    } catch (err) {
      if ((err as { status?: number }).status === 404) return null;
      throw err;
    }
  }

  async submitReview(owner: string, repo: string, number: number, input: SubmitReviewInput) {
    const event = ({ approve: "APPROVE", comment: "COMMENT", request_changes: "REQUEST_CHANGES" } as const)[
      input.event
    ];
    const { data } = await this.octokit.pulls.createReview({
      owner,
      repo,
      pull_number: number,
      commit_id: input.commitSha,
      body: input.body,
      event,
      comments: input.comments.map((c) => ({
        path: c.path,
        line: c.line,
        side: "RIGHT" as const,
        ...(c.startLine && c.startLine < c.line ? { start_line: c.startLine, start_side: "RIGHT" as const } : {}),
        body: c.body,
      })),
    });
    return { url: data.html_url };
  }
}
