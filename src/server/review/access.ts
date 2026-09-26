import "server-only";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "../db";
import { HttpError } from "../http";

export async function getOwnedReview(userId: string, reviewId: string) {
  const db = await getDb();
  const [review] = await db
    .select()
    .from(schema.reviews)
    .where(and(eq(schema.reviews.id, reviewId), eq(schema.reviews.userId, userId)))
    .limit(1);
  if (!review) throw new HttpError(404, "Review not found");
  return review;
}
