import "server-only";
import { eq, sql } from "drizzle-orm";
import { getDb, schema } from "../db";
import type { AiProvider, Finding, ScmConnection } from "../db/schema";
import { aiClientFor } from "../ai";
import type { AiClient } from "../ai/types";
import { providerFor } from "../scm";
import type { ScmFile, ScmPullDetail, ScmProvider } from "../scm/types";
import { commentableLines, parsePatch, snapToCommentable } from "@/lib/diff";
import { createFileFilter } from "./filter";
import { buildBatches, type ReviewFileInput } from "./chunk";
import { parseFindings, parseSummary, type RawFinding } from "./parse";
import { redactSecrets } from "./redact";
import { REVIEW_SYSTEM_PROMPT, SUMMARY_SYSTEM_PROMPT, reviewUserPrompt, summaryUserPrompt } from "./prompts";

export interface ReviewOptions {
  instructions?: string | null;
  extraIgnore?: string[];
  /** Fetch full file contents for small files so the model sees surrounding code. */
  fullFileContext?: boolean;
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

function budgetChars(provider: AiProvider) {
  const outputReserve = Math.min(4096, Math.floor(provider.maxContextTokens * 0.25));
  const systemTokens = REVIEW_SYSTEM_PROMPT.length / CHARS_PER_TOKEN;
  const promptOverhead = 1200; // title, description, instructions
  const tokens = provider.maxContextTokens - outputReserve - systemTokens - promptOverhead;
  return Math.max(2000, Math.floor(tokens * CHARS_PER_TOKEN));
}

function fallbackVerdict(fs: { severity: string }[]) {
  if (fs.some((f) => f.severity === "critical")) return "request_changes" as const;
  if (fs.some((f) => f.severity === "major")) return "comment" as const;
  return "approve" as const;
}

/**
 * Starts a review in the background and returns its id immediately.
 * Phase 1 runs in-process; Phase 3 moves this onto a durable job queue.
 */
export async function startReview(args: {
  userId: string;
  conn: ScmConnection;
  provider: AiProvider;
  owner: string;
  repo: string;
  number: number;
  options: ReviewOptions;
}): Promise<string> {
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
    })
    .returning({ id: schema.reviews.id });

  void runReview(review.id, scm, pr, args.provider, args.options).catch(async (err) => {
    console.error("[pr-review-ai] review failed", err);
    await db
      .update(schema.reviews)
      .set({ status: "failed", error: err instanceof Error ? err.message : String(err), completedAt: new Date() })
      .where(eq(schema.reviews.id, review.id));
  });
  return review.id;
}

async function runReview(
  reviewId: string,
  scm: ScmProvider,
  pr: ScmPullDetail,
  provider: AiProvider,
  options: ReviewOptions,
) {
  const db = await getDb();
  const ai = aiClientFor(provider);
  const files = await scm.getFiles(pr.owner, pr.repo, pr.number);
  const skip = createFileFilter(options.extraIgnore);
  const reviewable: ScmFile[] = files.filter((f) => !skip(f));
  const skipped = files.filter((f) => skip(f)).map((f) => f.path);

  const redactForCloud = !provider.isLocal;
  const redact = (s: string) => (redactForCloud ? redactSecrets(s).text : s);

  const inputs: ReviewFileInput[] = await pool(reviewable, 4, async (f) => {
    let content: string | null = null;
    if (options.fullFileContext !== false) {
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

  const batches = buildBatches(inputs, budgetChars(provider));
  const total = batches.length + 1;
  await db
    .update(schema.reviews)
    .set({ progress: { done: 0, total, current: "Reviewing files" }, skippedFiles: skipped })
    .where(eq(schema.reviews.id, reviewId));

  const commentable = new Map(reviewable.map((f) => [f.path, commentableLines(parsePatch(f.patch))]));
  const addTokens = (p: number, c: number) =>
    db
      .update(schema.reviews)
      .set({
        promptTokens: sql`${schema.reviews.promptTokens} + ${p}`,
        completionTokens: sql`${schema.reviews.completionTokens} + ${c}`,
      })
      .where(eq(schema.reviews.id, reviewId));

  let done = 0;
  const batchErrors: string[] = [];
  const allFindings: RawFinding[] = [];
  await pool(batches, CONCURRENCY, async (batch) => {
    try {
      const found = await reviewBatch(ai, pr, batch.text, options.instructions);
      await addTokens(found.promptTokens, found.completionTokens);
      allFindings.push(...found.findings.filter((f) => batch.paths.includes(resolvePath(f.file, batch.paths))));
    } catch (err) {
      batchErrors.push(`${batch.paths.join(", ")}: ${err instanceof Error ? err.message : String(err)}`);
    }
    done++;
    await db
      .update(schema.reviews)
      .set({ progress: { done, total, current: batch.paths[0] } })
      .where(eq(schema.reviews.id, reviewId));
  });

  if (batches.length && batchErrors.length === batches.length) {
    throw new Error(`All review requests failed. First error: ${batchErrors[0]}`);
  }

  const rows = dedupe(
    allFindings.map((f) => {
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
      };
    }),
  );
  if (rows.length) await db.insert(schema.findings).values(rows);

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
            instructions: options.instructions,
            files: files.map((f) => ({ path: f.path, status: f.status, additions: f.additions, deletions: f.deletions })),
            findings: rows.map((r) => ({ path: r.path, line: r.line, severity: r.severity, title: r.title })),
          }),
        ),
      },
    ],
    { json: true, maxTokens: 1500 },
  );
  await addTokens(summary.promptTokens, summary.completionTokens);
  const parsed = parseSummary(summary.content);
  // Never let the model approve over its own critical findings.
  const verdict = rows.some((r) => r.severity === "critical") ? "request_changes" : parsed.verdict ?? fallbackVerdict(rows);

  const errorNote = batchErrors.length
    ? `${batchErrors.length} of ${batches.length} review requests failed:\n${batchErrors.join("\n")}`
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

async function reviewBatch(ai: AiClient, pr: ScmPullDetail, diff: string, instructions?: string | null) {
  const messages = [
    { role: "system" as const, content: REVIEW_SYSTEM_PROMPT },
    { role: "user" as const, content: reviewUserPrompt({ title: pr.title, description: pr.body, instructions, diff }) },
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
