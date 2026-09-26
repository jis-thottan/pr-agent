import { z } from "zod";
import { getDb, schema } from "@/server/db";
import { route } from "@/server/http";
import { getOwnedReview } from "@/server/review/access";
import { CATEGORIES, SEVERITIES } from "@/server/db/schema";

const body = z.object({
  path: z.string().min(1),
  line: z.number().int().positive(),
  endLine: z.number().int().positive().nullish(),
  body: z.string().trim().min(1).max(20000),
  suggestion: z.string().nullish(),
  severity: z.enum(SEVERITIES).default("minor"),
  category: z.enum(CATEGORIES).default("maintainability"),
});

/** Adds a reviewer-written inline comment (always on a diff line chosen in the UI). */
export const POST = route<{ params: Promise<{ id: string }> }>(async (req, { user, params }) => {
  const { id } = await params;
  await getOwnedReview(user.id, id);
  const input = body.parse(await req.json());
  const db = await getDb();
  const [row] = await db
    .insert(schema.findings)
    .values({
      reviewId: id,
      source: "human",
      path: input.path,
      line: input.line,
      endLine: input.endLine && input.endLine > input.line ? input.endLine : null,
      inDiff: true,
      severity: input.severity,
      category: input.category,
      title: input.body.split("\n")[0].slice(0, 120),
      body: input.body,
      suggestion: input.suggestion || null,
      state: "accepted",
    })
    .returning();
  return { finding: row };
});
