import { z } from "zod";
import { eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/server/db";
import { audit, HttpError, route } from "@/server/http";
import { getConnection } from "@/server/scm";
import { getOwnedReview } from "@/server/review/access";
import { buildReviewPayload } from "@/server/review/post";

const body = z.object({
  event: z.enum(["approve", "comment", "request_changes"]),
  summary: z.string().max(60000).default(""),
  attribution: z.boolean().default(true),
  dryRun: z.boolean().default(false),
});

export const POST = route<{ params: Promise<{ id: string }> }>(async (req, { user, params }) => {
  const { id } = await params;
  const input = body.parse(await req.json());
  const review = await getOwnedReview(user.id, id);
  const db = await getDb();
  const findings = await db.select().from(schema.findings).where(eq(schema.findings.reviewId, id));
  const payload = buildReviewPayload({
    review,
    findings,
    summary: input.summary,
    reviewerName: user.name,
    attribution: input.attribution,
  });
  if (input.dryRun) return { preview: payload };
  if (!payload.body.trim() && !payload.comments.length && input.event !== "approve") {
    throw new HttpError(400, "Nothing to post: accept a finding or write a summary first");
  }

  const { scm } = await getConnection(user.id, review.connectionId);
  const pr = await scm.getPull(review.owner, review.repo, review.prNumber);
  if (pr.headSha !== review.headSha && payload.comments.length) {
    // Line numbers refer to the reviewed commit; GitHub maps them forward when commit_id is the reviewed SHA.
    console.info(`[pr-review-ai] PR moved from ${review.headSha} to ${pr.headSha}; posting against reviewed commit`);
  }
  const { url } = await scm.submitReview(review.owner, review.repo, review.prNumber, {
    commitSha: review.headSha,
    body: payload.body,
    event: input.event,
    comments: payload.comments,
  });

  await db.transaction(async (tx) => {
    if (payload.posted.length) {
      await tx.update(schema.findings).set({ state: "posted", updatedAt: new Date() }).where(inArray(schema.findings.id, payload.posted));
    }
    await tx.update(schema.reviews).set({ postedAt: new Date(), postedUrl: url, verdict: input.event }).where(eq(schema.reviews.id, id));
  });
  await audit(user.id, "review.post", {
    id,
    pr: `${review.owner}/${review.repo}#${review.prNumber}`,
    event: input.event,
    comments: payload.comments.length,
    url,
  });
  return { url, comments: payload.comments.length };
}, { perm: "post" });
