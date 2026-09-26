import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/server/db";
import { HttpError, route } from "@/server/http";
import { CATEGORIES, SEVERITIES } from "@/server/db/schema";

const body = z.object({
  state: z.enum(["pending", "accepted", "dismissed"]).optional(),
  title: z.string().trim().min(1).max(300).optional(),
  body: z.string().trim().min(1).max(20000).optional(),
  suggestion: z.string().nullable().optional(),
  severity: z.enum(SEVERITIES).optional(),
  category: z.enum(CATEGORIES).optional(),
});

type Ctx = { params: Promise<{ id: string }> };

async function ownedFinding(userId: string, id: string) {
  const db = await getDb();
  const [row] = await db
    .select({ finding: schema.findings })
    .from(schema.findings)
    .innerJoin(schema.reviews, eq(schema.reviews.id, schema.findings.reviewId))
    .where(and(eq(schema.findings.id, id), eq(schema.reviews.userId, userId)))
    .limit(1);
  if (!row) throw new HttpError(404, "Finding not found");
  return row.finding;
}

export const PATCH = route<Ctx>(async (req, { user, params }) => {
  const { id } = await params;
  const current = await ownedFinding(user.id, id);
  if (current.state === "posted") throw new HttpError(409, "This comment was already posted");
  const input = body.parse(await req.json());
  const db = await getDb();
  const [row] = await db
    .update(schema.findings)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(schema.findings.id, id))
    .returning();
  return { finding: row };
});

export const DELETE = route<Ctx>(async (_req, { user, params }) => {
  const { id } = await params;
  const current = await ownedFinding(user.id, id);
  if (current.source !== "human") throw new HttpError(400, "AI findings can be dismissed, not deleted");
  const db = await getDb();
  await db.delete(schema.findings).where(eq(schema.findings.id, id));
});
