import "server-only";
import { cached } from "../cache";
import { sha256 } from "../crypto";
import { unifiedDiff } from "@/lib/unified-diff";
import type {
  ReviewCommentInput,
  ScmFile,
  ScmProvider,
  ScmPullDetail,
  ScmPullSummary,
  ScmRepo,
  ScmViewer,
  SubmitReviewInput,
} from "./types";

// Azure DevOps Services (https://dev.azure.com/{org}) and Server (https://host/tfs/{collection}).
// In this app a repository is addressed as owner = project name, repo = repository name.

const API_VERSION = "7.1";
const MAX_REPOS = 2000;
const MAX_PROJECTS_FOR_INBOX = 100;
const MAX_DIFFED_FILES = 1000;
const MAX_BLOB_BYTES = 1_500_000;
const FILES_TTL_MS = 10 * 60_000;

type Identity = { id?: string; displayName?: string; uniqueName?: string; imageUrl?: string };
type Commit = { commitId: string } | undefined;

interface AdoPull {
  pullRequestId: number;
  title: string;
  description?: string;
  status: "active" | "completed" | "abandoned" | "notSet";
  isDraft?: boolean;
  createdBy?: Identity;
  creationDate: string;
  closedDate?: string;
  sourceRefName?: string;
  targetRefName?: string;
  labels?: { name: string; active?: boolean }[];
  reviewers?: (Identity & { vote?: number })[];
  mergeStatus?: string;
  lastMergeSourceCommit?: Commit;
  lastMergeTargetCommit?: Commit;
  repository?: { name: string; project?: { name: string } };
}

interface AdoIteration {
  id: number;
  sourceRefCommit?: Commit;
  targetRefCommit?: Commit;
  commonRefCommit?: Commit;
}

interface AdoChange {
  changeTrackingId?: number;
  changeType: string;
  item?: { objectId?: string; originalObjectId?: string; path?: string; isFolder?: boolean; gitObjectType?: string };
  originalPath?: string;
  sourceServerItem?: string;
}

class AdoError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

const VOTE = { approve: 10, request_changes: -5 } as const; // -5 = "waiting for author"

const branch = (ref?: string) => (ref ? ref.replace(/^refs\/heads\//, "") : null);
const isSha = (ref: string) => /^[0-9a-f]{40}$/i.test(ref);

function isBinary(buf: Uint8Array) {
  const n = Math.min(buf.length, 8000);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

function fileStatus(changeType: string): ScmFile["status"] {
  const t = changeType.toLowerCase();
  if (t.includes("delete")) return "removed";
  if (t.includes("add")) return "added";
  if (t.includes("rename")) return "renamed";
  return "modified";
}

async function pool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

export class AzureDevOpsProvider implements ScmProvider {
  private base: string;
  private auth: string;
  private cacheScope: string;
  private viewer?: Promise<ScmViewer & { id: string }>;

  constructor(token: string, baseUrl: string) {
    this.base = baseUrl.replace(/\/+$/, "");
    this.auth = "Basic " + Buffer.from(":" + token).toString("base64");
    // Cache entries are per token, so one user's access never serves another's.
    this.cacheScope = sha256(this.base + token).slice(0, 16);
  }

  private repoApi(project: string, repo: string) {
    return `${this.base}/${encodeURIComponent(project)}/_apis/git/repositories/${encodeURIComponent(repo)}`;
  }

  private webUrl(project: string, repo: string, id: number) {
    return `${this.base}/${encodeURIComponent(project)}/_git/${encodeURIComponent(repo)}/pullrequest/${id}`;
  }

  private async send(url: string, init: { method?: string; body?: unknown; raw?: boolean } = {}): Promise<Response> {
    const u = new URL(url);
    if (!u.searchParams.has("api-version") && !u.pathname.endsWith("/connectionData")) u.searchParams.set("api-version", API_VERSION);
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(u, {
        method: init.method ?? "GET",
        headers: {
          authorization: this.auth,
          accept: init.raw ? "application/octet-stream" : "application/json",
          ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
        },
        body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
        redirect: "manual",
        signal: AbortSignal.timeout(30_000),
      });
      // An invalid or expired PAT gets a 203 / redirect to an HTML sign-in page instead of a 401.
      if (res.status === 203 || (res.status >= 300 && res.status < 400)) {
        throw new AdoError(401, "Azure DevOps rejected the personal access token (expired, revoked or missing scopes)");
      }
      if (res.ok) return res;
      if ((res.status === 429 || res.status === 503) && attempt < 2) {
        const wait = Number(res.headers.get("retry-after")) || 2 ** attempt * 2;
        await new Promise((r) => setTimeout(r, Math.min(wait, 30) * 1000));
        continue;
      }
      const text = await res.text().catch(() => "");
      let message = text.slice(0, 300);
      try {
        message = (JSON.parse(text) as { message?: string }).message ?? message;
      } catch {}
      throw new AdoError(res.status, `Azure DevOps returned ${res.status}: ${message}`);
    }
  }

  private async json<T>(url: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
    const res = await this.send(url, init);
    const type = res.headers.get("content-type") ?? "";
    if (!type.includes("json")) throw new AdoError(401, "Azure DevOps returned a non-JSON response; check the organization URL and token");
    return (await res.json()) as T;
  }

  private me() {
    this.viewer ??= this.json<{
      authenticatedUser: { id: string; providerDisplayName?: string; properties?: { Account?: { $value?: string } } };
    }>(`${this.base}/_apis/connectionData`).then(({ authenticatedUser: u }) => ({
      id: u.id,
      login: u.properties?.Account?.$value || u.providerDisplayName || u.id,
      name: u.providerDisplayName ?? null,
      avatarUrl: null,
    }));
    this.viewer.catch(() => (this.viewer = undefined));
    return this.viewer;
  }

  async getViewer(): Promise<ScmViewer> {
    const { login, name, avatarUrl } = await this.me();
    return { login, name, avatarUrl };
  }

  async listRepos(): Promise<ScmRepo[]> {
    const { value } = await this.json<{
      value: {
        name: string;
        isDisabled?: boolean;
        defaultBranch?: string;
        webUrl?: string;
        project: { name: string; visibility?: string; lastUpdateTime?: string };
      }[];
    }>(`${this.base}/_apis/git/repositories`);
    return value
      .filter((r) => !r.isDisabled)
      .slice(0, MAX_REPOS)
      .map((r) => ({
        owner: r.project.name,
        name: r.name,
        fullName: `${r.project.name}/${r.name}`,
        private: r.project.visibility !== "public",
        description: null,
        defaultBranch: branch(r.defaultBranch) ?? "main",
        updatedAt: r.project.lastUpdateTime ?? null,
        url: r.webUrl ?? `${this.base}/${encodeURIComponent(r.project.name)}/_git/${encodeURIComponent(r.name)}`,
      }))
      .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
  }

  private toSummary(project: string, repo: string, p: AdoPull): ScmPullSummary {
    return {
      owner: project,
      repo,
      number: p.pullRequestId,
      title: p.title,
      author: p.createdBy?.displayName ?? p.createdBy?.uniqueName ?? "unknown",
      // Azure DevOps avatar URLs need the PAT, so the browser can't load them.
      authorAvatar: null,
      state: p.status === "active" ? "open" : p.status === "completed" ? "merged" : "closed",
      draft: Boolean(p.isDraft),
      createdAt: p.creationDate,
      updatedAt: p.closedDate ?? p.creationDate,
      sourceBranch: branch(p.sourceRefName),
      targetBranch: branch(p.targetRefName),
      url: this.webUrl(project, repo, p.pullRequestId),
      labels: (p.labels ?? []).filter((l) => l.active !== false).map((l) => l.name),
    };
  }

  async listPulls(project: string, repo: string, state: "open" | "closed" | "all"): Promise<ScmPullSummary[]> {
    const status = state === "open" ? "active" : "all";
    const { value } = await this.json<{ value: AdoPull[] }>(
      `${this.repoApi(project, repo)}/pullrequests?searchCriteria.status=${status}&$top=100`,
    );
    return value.filter((p) => state !== "closed" || p.status !== "active").map((p) => this.toSummary(project, repo, p));
  }

  async listReviewRequests(): Promise<ScmPullSummary[]> {
    const me = await this.me();
    const { value: projects } = await this.json<{ value: { name: string }[] }>(
      `${this.base}/_apis/projects?$top=${MAX_PROJECTS_FOR_INBOX}`,
    );
    const perProject = await pool(projects, 6, async (proj) => {
      const { value } = await this.json<{ value: AdoPull[] }>(
        `${this.base}/${encodeURIComponent(proj.name)}/_apis/git/pullrequests?searchCriteria.reviewerId=${me.id}&searchCriteria.status=active&$top=50`,
      ).catch(() => ({ value: [] as AdoPull[] }));
      // Like GitHub's review-requested, drop PRs the viewer has already voted on.
      return value
        .filter((p) => (p.reviewers ?? []).some((r) => r.id === me.id && !r.vote))
        .map((p) => this.toSummary(p.repository?.project?.name ?? proj.name, p.repository?.name ?? "", p));
    });
    return perProject
      .flat()
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 50);
  }

  private async pullContext(project: string, repo: string, id: number) {
    const api = this.repoApi(project, repo);
    const [pr, { value: iterations }] = await Promise.all([
      this.json<AdoPull>(`${api}/pullrequests/${id}`),
      this.json<{ value: AdoIteration[] }>(`${api}/pullRequests/${id}/iterations`),
    ]);
    const last = iterations.at(-1);
    const headSha = last?.sourceRefCommit?.commitId ?? pr.lastMergeSourceCommit?.commitId ?? "";
    // Diff against the merge base, like the Azure DevOps "Files" tab.
    const baseSha = last?.commonRefCommit?.commitId ?? pr.lastMergeTargetCommit?.commitId ?? "";
    return { pr, iterations, last, headSha, baseSha };
  }

  async getPull(project: string, repo: string, id: number): Promise<ScmPullDetail> {
    const ctx = await this.pullContext(project, repo, id);
    const [files, commits] = await Promise.all([
      this.filesFor(project, repo, id, ctx),
      this.json<{ value: unknown[] }>(`${this.repoApi(project, repo)}/pullRequests/${id}/commits?$top=500`).catch(() => ({ value: [] })),
    ]);
    return {
      ...this.toSummary(project, repo, ctx.pr),
      body: ctx.pr.description ?? "",
      headSha: ctx.headSha,
      baseSha: ctx.baseSha,
      additions: files.reduce((n, f) => n + f.additions, 0),
      deletions: files.reduce((n, f) => n + f.deletions, 0),
      changedFiles: files.length,
      commits: commits.value.length,
      mergeable: ctx.pr.mergeStatus === "conflicts" ? false : ctx.pr.mergeStatus === "succeeded" ? true : null,
    };
  }

  async getFiles(project: string, repo: string, id: number): Promise<ScmFile[]> {
    return this.filesFor(project, repo, id, await this.pullContext(project, repo, id));
  }

  private async changes(project: string, repo: string, id: number, iteration: number): Promise<AdoChange[]> {
    const out: AdoChange[] = [];
    let skip = 0;
    for (;;) {
      const page = await this.json<{ changeEntries: AdoChange[]; nextSkip?: number }>(
        `${this.repoApi(project, repo)}/pullRequests/${id}/iterations/${iteration}/changes?$compareTo=0&$top=2000&$skip=${skip}`,
      );
      out.push(...page.changeEntries);
      if (!page.nextSkip || page.nextSkip <= skip) return out;
      skip = page.nextSkip;
    }
  }

  /** Changed files with unified patches computed from the blobs at the merge base and the PR head. */
  private filesFor(
    project: string,
    repo: string,
    id: number,
    ctx: Awaited<ReturnType<AzureDevOpsProvider["pullContext"]>>,
  ): Promise<ScmFile[]> {
    if (!ctx.last) return Promise.resolve([]);
    const iteration = ctx.last.id;
    const key = `ado-files:${this.cacheScope}:${project}/${repo}#${id}@${ctx.headSha}..${ctx.baseSha}`;
    return cached(key, FILES_TTL_MS, async () => {
      const entries = (await this.changes(project, repo, id, iteration)).filter(
        (c) => c.item?.path && !c.item.isFolder && c.item.gitObjectType !== "tree",
      );
      return pool(entries.map((c, index) => ({ c, index })), 8, async ({ c, index }): Promise<ScmFile> => {
        const status = fileStatus(c.changeType);
        const path = c.item!.path!.replace(/^\//, "");
        const previousRaw = c.originalPath ?? c.sourceServerItem;
        const previousPath = status === "renamed" && previousRaw ? previousRaw.replace(/^\//, "") : null;
        const file: ScmFile = {
          path,
          previousPath,
          status,
          additions: 0,
          deletions: 0,
          patch: null,
          sha: (status === "removed" ? c.item!.originalObjectId : c.item!.objectId) ?? null,
        };
        if (index >= MAX_DIFFED_FILES) return file;
        const [oldText, newText] = await Promise.all([
          status === "added"
            ? ""
            : c.item!.originalObjectId
              ? this.blob(project, repo, c.item!.originalObjectId)
              : this.byPath(project, repo, previousPath ?? path, ctx.baseSha),
          status === "removed" ? "" : c.item!.objectId ? this.blob(project, repo, c.item!.objectId) : this.byPath(project, repo, path, ctx.headSha),
        ]);
        if (oldText === null || newText === null) return file; // binary or too large
        const diff = unifiedDiff(oldText, newText);
        return { ...file, additions: diff.additions, deletions: diff.deletions, patch: diff.patch || null };
      });
    });
  }

  private async text(res: Response): Promise<string | null> {
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.length > MAX_BLOB_BYTES || isBinary(buf)) return null;
    return new TextDecoder("utf-8").decode(buf);
  }

  private async blob(project: string, repo: string, objectId: string): Promise<string | null> {
    try {
      return await this.text(await this.send(`${this.repoApi(project, repo)}/blobs/${objectId}?$format=octetstream`, { raw: true }));
    } catch (err) {
      if ((err as AdoError).status === 404) return "";
      throw err;
    }
  }

  private async byPath(project: string, repo: string, path: string, ref: string): Promise<string | null> {
    const type = isSha(ref) ? "commit" : "branch";
    const url =
      `${this.repoApi(project, repo)}/items?path=${encodeURIComponent("/" + path.replace(/^\//, ""))}` +
      `&versionDescriptor.version=${encodeURIComponent(ref)}&versionDescriptor.versionType=${type}&$format=octetStream`;
    try {
      return await this.text(await this.send(url, { raw: true }));
    } catch (err) {
      if ((err as AdoError).status === 404) return null;
      throw err;
    }
  }

  async getFileContent(project: string, repo: string, path: string, ref: string): Promise<string | null> {
    return this.byPath(project, repo, path, ref);
  }

  /**
   * Azure DevOps has no single "review" object: each inline comment becomes its own thread,
   * the summary becomes a general thread, and the verdict becomes the reviewer's vote.
   */
  async submitReview(project: string, repo: string, id: number, input: SubmitReviewInput) {
    const api = this.repoApi(project, repo);
    const [me, ctx] = await Promise.all([this.me(), this.pullContext(project, repo, id)]);
    const iteration = ctx.iterations.find((i) => i.sourceRefCommit?.commitId === input.commitSha) ?? ctx.last;
    const tracking = new Map<string, number>();
    if (iteration) {
      for (const c of await this.changes(project, repo, id, iteration.id)) {
        if (c.item?.path && c.changeTrackingId) tracking.set(c.item.path.replace(/^\//, ""), c.changeTrackingId);
      }
    }

    const failed: ReviewCommentInput[] = [];
    for (const c of input.comments) {
      try {
        await this.json(`${api}/pullRequests/${id}/threads`, {
          method: "POST",
          body: {
            comments: [{ parentCommentId: 0, content: c.body, commentType: "text" }],
            status: "active",
            threadContext: {
              filePath: "/" + c.path,
              rightFileStart: { line: c.startLine && c.startLine < c.line ? c.startLine : c.line, offset: 1 },
              rightFileEnd: { line: c.line, offset: 1 },
            },
            ...(iteration
              ? {
                  pullRequestThreadContext: {
                    changeTrackingId: tracking.get(c.path),
                    // Equal iterations mean "compared with the merge base", the default Files view.
                    iterationContext: { firstComparingIteration: iteration.id, secondComparingIteration: iteration.id },
                  },
                }
              : {}),
          },
        });
      } catch (err) {
        console.warn(`[pr-review-ai] Azure DevOps rejected inline comment on ${c.path}:${c.line}`, err);
        failed.push(c);
      }
    }

    let body = input.body.trim();
    if (failed.length) {
      body +=
        "\n\n### Comments that could not be attached to a line\n\n" +
        failed.map((c) => `- \`${c.path}:${c.line}\`\n\n  ${c.body.replace(/\n/g, "\n  ")}`).join("\n");
    }
    let threadId: number | null = null;
    if (body.trim()) {
      const thread = await this.json<{ id: number }>(`${api}/pullRequests/${id}/threads`, {
        method: "POST",
        body: {
          comments: [{ parentCommentId: 0, content: body.trim(), commentType: "text" }],
          // An open summary thread would block merges under the "resolve all comments" policy.
          status: input.event === "request_changes" ? "active" : "closed",
        },
      });
      threadId = thread.id;
    }

    if (input.event !== "comment") {
      await this.json(`${api}/pullRequests/${id}/reviewers/${me.id}`, {
        method: "PUT",
        body: { id: me.id, vote: VOTE[input.event] },
      });
    }

    const url = this.webUrl(project, repo, id);
    return { url: threadId ? `${url}?discussionId=${threadId}` : url };
  }
}
