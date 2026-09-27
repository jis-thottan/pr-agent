import { and, eq, gte, inArray, ne, sql } from "drizzle-orm";
import { getDb, schema } from "@/server/db";
import { route } from "@/server/http";
import { aggregate } from "@/server/dashboard/metrics";

const MAX_REVIEWS = 5000;

/** Team metrics for the last N days (7, 30 or 90). */
export const GET = route(async (req) => {
  const d = Number(new URL(req.url).searchParams.get("days"));
  const days = [7, 30, 90].includes(d) ? d : 30;
  const until = new Date();
  const since = new Date(until.getTime() - (days - 1) * 86_400_000);
  since.setUTCHours(0, 0, 0, 0);

  const db = await getDb();
  const reviews = await db
    .select({
      id: schema.reviews.id,
      userId: schema.reviews.userId,
      owner: schema.reviews.owner,
      repo: schema.reviews.repo,
      trigger: schema.reviews.trigger,
      status: schema.reviews.status,
      baseReviewId: schema.reviews.baseReviewId,
      costUsd: schema.reviews.costUsd,
      createdAt: schema.reviews.createdAt,
      completedAt: schema.reviews.completedAt,
      postedAt: schema.reviews.postedAt,
    })
    .from(schema.reviews)
    .where(and(gte(schema.reviews.createdAt, since), ne(schema.reviews.model, "manual")))
    .limit(MAX_REVIEWS);

  const ids = reviews.map((r) => r.id);
  const findings = ids.length
    ? (
        await db
          .select({
            reviewId: schema.findings.reviewId,
            severity: schema.findings.severity,
            category: schema.findings.category,
            state: schema.findings.state,
            n: sql<number>`count(*)::int`,
          })
          .from(schema.findings)
          // Carried-over findings were already counted in the review they came from.
          .where(and(inArray(schema.findings.reviewId, ids), eq(schema.findings.source, "ai"), sql`${schema.findings.carriedFromId} is null`))
          .groupBy(schema.findings.reviewId, schema.findings.severity, schema.findings.category, schema.findings.state)
      ).map((f) => ({ ...f, n: Number(f.n) }))
    : [];
  const users = new Map((await db.select({ id: schema.users.id, name: schema.users.name }).from(schema.users)).map((u) => [u.id, u.name]));

  const [chat] = await db
    .select({ usd: sql<number>`coalesce(sum(${schema.aiUsage.costUsd}), 0)` })
    .from(schema.aiUsage)
    .where(and(gte(schema.aiUsage.createdAt, since), eq(schema.aiUsage.kind, "chat")));

  return {
    days,
    since: since.toISOString(),
    truncated: reviews.length >= MAX_REVIEWS,
    chatCostUsd: Number(chat?.usd ?? 0),
    ...aggregate(reviews, findings, users, since, until),
  };
}, { perm: "dashboard" });
