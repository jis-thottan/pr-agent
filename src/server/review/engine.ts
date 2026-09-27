import "server-only";
import { and, desc, eq, isNotNull, ne, or, sql } from "drizzle-orm";
import { getDb, schema } from "../db";
import type { AiProvider, AppliedRepoRules, Finding, Review, ScmConnection, Severity } from "../db/schema";
import { aiClientFor } from "../ai";
import type { AiClient } from "../ai/types";
import { providerFor } from "../scm";
import type { ScmFile, ScmPullDetail, ScmProvider } from "../scm/types";
import { commentableLines, parsePatch, snapToCommentable } from "@/lib/diff";
import { createFileFilter } from "./filter";
import { buildBatches, type ReviewFileInput } from "./chunk";
import { parseFindings, parseSummary, type RawFinding } from "./parse";
import { redactSecrets } from "./redact";
import { instructionsForPaths, meetsSeverity, stricterSeverity, type RepoRules } from "./rules";
import { loadRepoRules } from "./rules-loader";
import { carryForward, shaMap, splitBySha } from "./incremental";
import { enqueue } from "../jobs/queue";
import { checkBudget, costOf, metered } from "../usage";
import { REVIEW_SYSTEM_PROMPT, SUMMARY_SYSTEM_PROMPT, reviewUserPrompt, summaryUserPrompt } from "./prompts";

export interface ReviewOptions {
  instructions?: string | null;
  extraIgnore?: string[];
  /** Fetch full file contents for small files so the model sees surrounding code. */
  fullFileContext?: boolean;
  /** Drop findings below this severity. */
  minSeverity?: Severity | null;
  /** Read .pr-review.yml from the target branch and apply it (default true). */
  repoRules?: boolean;
  profileId?: string | null;
  /** Only review files changed since an earlier completed review; carry its other findings forward. */
  incremental?: boolean;
  /** The review to compare with (defaults to the newest completed one at another commit). */
  baseReviewId?: string | null;
}

const CONCURRENCY = Math.max(1, Number(process.env.AI_CONCURRENCY ?? 2));
const CHARS_PER_TOKEN = 3.5;
const MAX_CONTEXT_FILE_CHARS = 40_000;

async function pool<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await fn(items[i], i);
      }
    }),
  );
  return results;
}

function budgetChars(provider: AiProvider, instructionChars: number) {
  const outputReserve = Math.min(4096, Math.floor(provider.maxContextTokens * 0.25));
  const systemTokens = REVIEW_SYSTEM_PROMPT.length / CHARS_PER_TOKEN;
  const promptOverhead = 1200 + instructionChars / CHARS_PER_TOKEN; // title, description, instructions, repo rules
  const tokens = provider.maxContextTokens - outputReserve - systemTokens - promptOverhead;
  return Math.max(2000, Math.floor(tokens * CHARS_PER_TOKEN));
}

function fallbackVerdict(fs: { severity: string }[]) {
  if (fs.some((f) => f.severity === "critical")) return "request_changes" as const;
  if (fs.some((f) => f.severity === "major")) return "comment" as const;
  return "approve" as const;
}

export class ReviewError extends Error {
  constructor(
    message: string,
    public status?: number,
  ) {
    super(message);
  }
}

type NewReview = {
  userId: string;
  conn: ScmConnection;
  provider: AiProvider;
  owner: string;
  repo: string;
  number: number;
  options: ReviewOptions;
  trigger?: "manual" | "webhook";
  autoRuleId?: string | null;
};

/**
 * Records a queued review and puts it on the durable job queue; the worker runs it.
 * Returns the review id immediately.
 */
export async function startReview(args: NewReview): Promise<string> {
  await checkBudget(args.userId, args.provider);
  const scm = providerFor(args.conn);
  const pr = await scm.getPull(args.owner, args.repo, args.number);
  const db = await getDb();
  const [review] = await db
    .insert(schema.reviews)
    .values({
      userId: args.userId,
      connectionId: args.conn.id,
      owner: args.owner,
      repo: args.repo,
      prNumber: args.number,
      headSha: pr.headSha,
      baseSha: pr.baseSha,
      providerId: args.provider.id,
      model: args.provider.model,
      instructions: args.options.instructions ?? null,
      profileId: args.options.profileId ?? null,
      minSeverity: args.options.minSeverity ?? null,
      status: "queued",
      trigger: args.trigger ?? "manual",
      autoRuleId: args.autoRuleId ?? null,
      progress: { done: 0, total: 0, current: "Waiting for a worker" },
    })
    .returning({ id: schema.reviews.id });
  await enqueue("review", { reviewId: review.id, options: args.options });
  return review.id;
}

/** Job handler: runs (or re-runs, after a crash) one queued review. */
export async function executeReview(reviewId: string, options: ReviewOptions) {
  const db = await getDb();
  const [review] = await db.select().from(schema.reviews).where(eq(schema.reviews.id, reviewId)).limit(1);
  if (!review || review.status === "completed") return;
  const [conn] = await db.select().from(schema.scmConnections).where(eq(schema.scmConnections.id, review.connectionId)).limit(1);
  if (!conn) throw new ReviewError("The code host connection was removed", 400);
  const [provider] = review.providerId
    ? await db.select().from(schema.aiProviders).where(eq(schema.aiProviders.id, review.providerId)).limit(1)
    : [];
  if (!provider) throw new ReviewError("The AI provider for this review was deleted", 400);

  // A retry starts clean: drop AI and carried findings from an interrupted attempt; keep human comments.
  await db
    .delete(schema.findings)
    .where(and(eq(schema.findings.reviewId, reviewId), or(eq(schema.findings.source, "ai"), isNotNull(schema.findings.carriedFromId))));
  await db
    .update(schema.reviews)
    .set({ status: "running", error: null, progress: { done: 0, total: 0, current: "Fetching the pull request" } })
    .where(eq(schema.reviews.id, reviewId));

  const scm = providerFor(conn);
  const pr = await scm.getPull(review.owner, review.repo, review.prNumber);
  if (pr.headSha !== review.headSha || pr.baseSha !== review.baseSha) {
    // Pushed while queued: review what is there now.
    await db.update(schema.reviews).set({ headSha: pr.headSha, baseSha: pr.baseSha }).where(eq(schema.reviews.id, reviewId));
  }
  await runReview({ ...review, headSha: pr.headSha }, scm, pr, provider, options);
}

/** The newest completed AI review of this PR at a different commit, to diff file SHAs against. */
async function findBaseReview(review: Review, requestedId?: string | null) {
  const db = await getDb();
  const conds = [
    eq(schema.reviews.userId, review.userId),
    eq(schema.reviews.connectionId, review.connectionId),
    eq(schema.reviews.owner, review.owner),
    eq(schema.reviews.repo, review.repo),
    eq(schema.reviews.prNumber, review.prNumber),
    eq(schema.reviews.status, "completed"),
    ne(schema.reviews.model, "manual"),
    ne(schema.reviews.id, review.id),
  ];
  if (requestedId) conds.push(eq(schema.reviews.id, requestedId));
  const [base] = await db.select().from(schema.reviews).where(and(...conds)).orderBy(desc(schema.reviews.createdAt)).limit(1);
  if (!base || base.headSha === review.headSha || !Object.keys(base.fileShas).length) return null;
  return base;
}

async function runReview(review: Review, scm: ScmProvider, pr: ScmPullDetail, provider: AiProvider, options: ReviewOptions) {
  const reviewId = review.id;
  const db = await getDb();
  const ai = metered(aiClientFor(provider), {
    userId: review.userId,
    provider,
    kind: "review",
    reviewId,
    onCost: async (usd) => {
      if (usd) await db.update(schema.reviews).set({ costUsd: sql`${schema.reviews.costUsd} + ${usd}` }).where(eq(schema.reviews.id, reviewId));
    },
  });
  const [files, loadedRules] = await Promise.all([
    scm.getFiles(pr.owner, pr.repo, pr.number),
    options.repoRules === false ? null : loadRepoRules(scm, pr.owner, pr.repo, pr.baseSha),
  ]);
  const rules: RepoRules | null = loadedRules?.rules ?? null;
  const minSeverity = stricterSeverity(options.minSeverity, rules?.minSeverity);
  const fullFileContext = options.fullFileContext !== false && rules?.fullFileContext !== false;
  if (loadedRules) {
    const applied: AppliedRepoRules = {
      path: loadedRules.path,
      ref: loadedRules.ref,
      instructions: rules?.instructions ?? null,
      ignore: rules?.ignore ?? [],
      minSeverity: rules?.minSeverity ?? null,
      pathInstructions: rules?.pathInstructions ?? [],
      warnings: loadedRules.warnings,
    };
    await db.update(schema.reviews).set({ repoRules: applied, minSeverity }).where(eq(schema.reviews.id, reviewId));
  }
  const skip = createFileFilter([...(options.extraIgnore ?? []), ...(rules?.ignore ?? [])]);
  const reviewableAll: ScmFile[] = files.filter((f) => !skip(f));
  const skipped = files.filter((f) => skip(f)).map((f) => f.path);

  // Incremental: only send files whose blob changed since the base review.
  const base = options.incremental ? await findBaseReview(review, options.baseReviewId) : null;
  const { changed: reviewable, unchanged } = base
    ? splitBySha(reviewableAll, base.fileShas)
    : { changed: reviewableAll, unchanged: [] as ScmFile[] };
  await db
    .update(schema.reviews)
    .set({ fileShas: shaMap(files), baseReviewId: base?.id ?? null, unchangedFiles: unchanged.map((f) => f.path) })
    .where(eq(schema.reviews.id, reviewId));

  const redactForCloud = !provider.isLocal;
  const redact = (s: string) => (redactForCloud ? redactSecrets(s).text : s);

  const inputs: ReviewFileInput[] = await pool(reviewable, 4, async (f) => {
    let content: string | null = null;
    if (fullFileContext) {
      content = await scm.getFileContent(pr.owner, pr.repo, f.path, pr.headSha).catch(() => null);
      if (content && content.length > MAX_CONTEXT_FILE_CHARS) content = null;
    }
    return {
      path: f.path,
      previousPath: f.previousPath,
      status: f.status,
      patch: redact(f.patch!),
      content: content == null ? null : redact(content),
    };
  });

  const instructionChars =
    (options.instructions?.length ?? 0) +
    (rules?.instructions?.length ?? 0) +
    (rules?.pathInstructions ?? []).reduce((n, r) => n + r.path.length + r.instructions.length + 20, 0);
  const batches = buildBatches(inputs, budgetChars(provider, instructionChars));
  const total = batches.length + 1;

  // Refuse up front when the estimated cost would break a budget, rather than failing halfway.
  const estInput = batches.reduce((n, b) => n + (b.text.length + REVIEW_SYSTEM_PROMPT.length + instructionChars) / CHARS_PER_TOKEN, 0) + 3000;
  const estOutput = batches.length * 1500 + 1500;
  await checkBudget(review.userId, provider, costOf(provider, estInput, estOutput));

  await db
    .update(schema.reviews)
    .set({ progress: { done: 0, total, current: "Reviewing files" }, skippedFiles: skipped })
    .where(eq(schema.reviews.id, reviewId));

  const commentable = new Map(reviewableAll.map((f) => [f.path, commentableLines(parsePatch(f.patch))]));
  const addTokens = (p: number, c: number) =>
    db
      .update(schema.reviews)
      .set({
        promptTokens: sql`${schema.reviews.promptTokens} + ${p}`,
        completionTokens: sql`${schema.reviews.completionTokens} + ${c}`,
      })
      .where(eq(schema.reviews.id, reviewId));

  let done = 0;
  const batchErrors: { text: string; status?: number }[] = [];
  const allFindings: RawFinding[] = [];
  await pool(batches, CONCURRENCY, async (batch) => {
    try {
      const repoText = rules
        ? [rules.instructions, instructionsForPaths(rules, batch.paths)].filter(Boolean).join("\n\n") || null
        : null;
      const found = await reviewBatch(ai, pr, batch.text, options.instructions, repoText);
      await addTokens(found.promptTokens, found.completionTokens);
      allFindings.push(...found.findings.filter((f) => batch.paths.includes(resolvePath(f.file, batch.paths))));
    } catch (err) {
      batchErrors.push({
        text: `${batch.paths.join(", ")}: ${err instanceof Error ? err.message : String(err)}`,
        status: (err as { status?: number }).status,
      });
    }
    done++;
    await db
      .update(schema.reviews)
      .set({ progress: { done, total, current: batch.paths[0] } })
      .where(eq(schema.reviews.id, reviewId));
  });

  if (batches.length && batchErrors.length === batches.length) {
    throw new ReviewError(`All review requests failed. First error: ${batchErrors[0].text}`, batchErrors[0].status);
  }

  const newRows = dedupe(
    allFindings.filter((f) => meetsSeverity(f.severity, minSeverity)).map((f) => {
      const path = resolvePath(f.file, reviewable.map((r) => r.path));
      const lines = commentable.get(path) ?? new Set<number>();
      const line = f.line ? snapToCommentable(f.line, lines) : null;
      let endLine = f.endLine && line && f.endLine > line && lines.has(f.endLine) ? f.endLine : null;
      // GitHub needs every line of a multi-line comment inside one hunk; keep ranges small and safe.
      if (endLine && line && endLine - line > 30) endLine = null;
      return {
        reviewId,
        source: "ai" as const,
        path,
        line: line ?? f.line ?? null,
        endLine,
        inDiff: line !== null,
        severity: f.severity,
        category: f.category,
        title: f.title.trim(),
        body: f.message.trim(),
        // Keep indentation: a GitHub suggestion replaces the lines verbatim.
        suggestion: f.suggestion?.replace(/^\s*\n/, "").trimEnd() || null,
        state: "pending" as Finding["state"],
      };
    }),
  );

  const carriedRows = base
    ? carryForward(
        await db.select().from(schema.findings).where(eq(schema.findings.reviewId, base.id)),
        new Set(unchanged.map((f) => f.path)),
        commentable,
      ).map(({ id: _id, createdAt: _c, updatedAt: _u, ...f }) => ({ ...f, reviewId }))
    : [];
  if (newRows.length) await db.insert(schema.findings).values(newRows);
  if (carriedRows.length) await db.insert(schema.findings).values(carriedRows);
  const rows = [...newRows, ...carriedRows];

  await db
    .update(schema.reviews)
    .set({ progress: { done, total, current: "Writing summary" } })
    .where(eq(schema.reviews.id, reviewId));

  const summary = await ai.chat(
    [
      { role: "system", content: SUMMARY_SYSTEM_PROMPT },
      {
        role: "user",
        content: redact(
          summaryUserPrompt({
            title: pr.title,
            description: pr.body,
            instructions: [rules?.instructions, options.instructions].filter(Boolean).join("\n\n") || null,
            files: files.map((f) => ({ path: f.path, status: f.status, additions: f.additions, deletions: f.deletions })),
            findings: rows
              .filter((r) => r.state !== "dismissed")
              .map((r) => ({ path: r.path, line: r.line, severity: r.severity, title: r.title })),
            note: base
              ? `This is an incremental review: ${reviewable.length} file(s) changed since the previous review at commit ${base.headSha.slice(0, 7)}; findings on the ${unchanged.length} unchanged file(s) were carried over from it.`
              : null,
          }),
        ),
      },
    ],
    { json: true, maxTokens: 1500 },
  );
  await addTokens(summary.promptTokens, summary.completionTokens);
  const parsed = parseSummary(summary.content);
  // Never let the model approve over a critical finding that is still open.
  const verdict = rows.some((r) => r.severity === "critical" && r.state !== "dismissed")
    ? "request_changes"
    : (parsed.verdict ?? fallbackVerdict(rows));

  const errorNote = batchErrors.length
    ? `${batchErrors.length} of ${batches.length} review requests failed:\n${batchErrors.map((e) => e.text).join("\n")}`
    : null;
  await db
    .update(schema.reviews)
    .set({
      status: "completed",
      summary: parsed.summary,
      riskLevel: parsed.riskLevel,
      verdict,
      error: errorNote,
      progress: { done: total, total },
      completedAt: new Date(),
    })
    .where(eq(schema.reviews.id, reviewId));
}

async function reviewBatch(
  ai: AiClient,
  pr: ScmPullDetail,
  diff: string,
  instructions: string | null | undefined,
  repoRules: string | null,
) {
  const messages = [
    { role: "system" as const, content: REVIEW_SYSTEM_PROMPT },
    { role: "user" as const, content: reviewUserPrompt({ title: pr.title, description: pr.body, instructions, repoRules, diff }) },
  ];
  let res = await ai.chat(messages, { json: true, maxTokens: 4096 });
  let promptTokens = res.promptTokens;
  let completionTokens = res.completionTokens;
  try {
    return { findings: parseFindings(res.content), promptTokens, completionTokens };
  } catch {
    // One repair attempt for models that wrap or break the JSON.
    res = await ai.chat(
      [
        ...messages,
        { role: "assistant", content: res.content },
        { role: "user", content: 'That was not valid JSON. Reply with ONLY the JSON object {"findings":[...]}.' },
      ],
      { json: true, maxTokens: 4096 },
    );
    promptTokens += res.promptTokens;
    completionTokens += res.completionTokens;
    return { findings: parseFindings(res.content), promptTokens, completionTokens };
  }
}

/** Maps a model-reported path to a real PR path (models sometimes add ./, a/ or drop directories). */
function resolvePath(reported: string, paths: string[]): string {
  const clean = reported.trim().replace(/^(\.\/|a\/|b\/|\/)/, "");
  if (paths.includes(clean)) return clean;
  const bySuffix = paths.filter((p) => p.endsWith("/" + clean) || clean.endsWith("/" + p));
  if (bySuffix.length === 1) return bySuffix[0];
  const base = clean.split("/").pop();
  const byBase = paths.filter((p) => p.split("/").pop() === base);
  return byBase.length === 1 ? byBase[0] : clean;
}

function dedupe<T extends Pick<Finding, "path" | "line" | "title">>(rows: T[]): T[] {
  const seen = new Set<string>();
  return rows.filter((r) => {
    const key = `${r.path}:${r.line}:${r.title.toLowerCase().replace(/\W+/g, "").slice(0, 40)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
