import { asc, eq } from "drizzle-orm";
import { getDb, schema } from "@/server/db";
import { route } from "@/server/http";
import { getOwnedReview } from "@/server/review/access";

export const GET = route<{ params: Promise<{ id: string }> }>(async (_req, { user, params }) => {
  const { id } = await params;
  const review = await getOwnedReview(user.id, id);
  const db = await getDb();
  const findings = await db
    .select()
    .from(schema.findings)
    .where(eq(schema.findings.reviewId, id))
    .orderBy(asc(schema.findings.path), asc(schema.findings.line));
  return { review, findings };
});
