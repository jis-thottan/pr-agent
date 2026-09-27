import { and, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/server/db";
import { route } from "@/server/http";
import { getConnection } from "@/server/scm";
import { prParams, type PrCtx } from "@/server/pr";

/** Everything the review workspace needs for one PR. */
export const GET = route<PrCtx>(async (_req, { user, params }) => {
  const { connId, owner, repo, number, prKey } = await prParams(params);
  const { conn, scm } = await getConnection(user.id, connId);
  const db = await getDb();
  const [pr, files, viewed, reviews] = await Promise.all([
    scm.getPull(owner, repo, number),
    scm.getFiles(owner, repo, number),
    db
      .select({ path: schema.viewedFiles.path, sha: schema.viewedFiles.sha })
      .from(schema.viewedFiles)
      .where(
        and(
          eq(schema.viewedFiles.userId, user.id),
          eq(schema.viewedFiles.connectionId, connId),
          eq(schema.viewedFiles.prKey, prKey),
        ),
      ),
    db
      .select({
        id: schema.reviews.id,
        status: schema.reviews.status,
        model: schema.reviews.model,
        headSha: schema.reviews.headSha,
        createdAt: schema.reviews.createdAt,
        postedAt: schema.reviews.postedAt,
      })
      .from(schema.reviews)
      .where(
        and(
          eq(schema.reviews.connectionId, connId),
          eq(schema.reviews.owner, owner),
          eq(schema.reviews.repo, repo),
          eq(schema.reviews.prNumber, number),
          eq(schema.reviews.userId, user.id),
        ),
      )
      .orderBy(desc(schema.reviews.createdAt))
      .limit(20),
  ]);
  return { pr, files, viewed, reviews, host: conn.provider };
});
