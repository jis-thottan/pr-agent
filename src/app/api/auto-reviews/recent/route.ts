import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb, schema } from "@/server/db";
import { route } from "@/server/http";

/** The user's latest webhook-triggered draft reviews, for the Inbox. */
export const GET = route(async (_req, { user }) => {
  const db = await getDb();
  const reviews = await db
    .select({
      id: schema.reviews.id,
      connectionId: schema.reviews.connectionId,
      owner: schema.reviews.owner,
      repo: schema.reviews.repo,
      prNumber: schema.reviews.prNumber,
      status: schema.reviews.status,
      verdict: schema.reviews.verdict,
      riskLevel: schema.reviews.riskLevel,
      model: schema.reviews.model,
      error: schema.reviews.error,
      costUsd: schema.reviews.costUsd,
      baseReviewId: schema.reviews.baseReviewId,
      createdAt: schema.reviews.createdAt,
      postedAt: schema.reviews.postedAt,
    })
    .from(schema.reviews)
    .where(and(eq(schema.reviews.userId, user.id), eq(schema.reviews.trigger, "webhook")))
    .orderBy(desc(schema.reviews.createdAt))
    .limit(20);
  const counts = reviews.length
    ? await db
        .select({ reviewId: schema.findings.reviewId, severity: schema.findings.severity, n: sql<number>`count(*)::int` })
        .from(schema.findings)
        .where(and(inArray(schema.findings.reviewId, reviews.map((r) => r.id)), eq(schema.findings.source, "ai")))
        .groupBy(schema.findings.reviewId, schema.findings.severity)
    : [];
  return {
    reviews: reviews.map((r) => ({
      ...r,
      counts: Object.fromEntries(counts.filter((c) => c.reviewId === r.id).map((c) => [c.severity, Number(c.n)])),
    })),
  };
});
