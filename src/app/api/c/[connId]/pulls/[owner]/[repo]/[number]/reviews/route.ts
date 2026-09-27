import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/server/db";
import { audit, HttpError, route } from "@/server/http";
import { getConnection } from "@/server/scm";
import { prParams, type PrCtx } from "@/server/pr";
import { startReview } from "@/server/review/engine";
import { getVisibleProfile } from "@/server/profiles";
import { SEVERITIES } from "@/server/db/schema";

const body = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("ai"),
    providerId: z.string().uuid(),
    instructions: z.string().max(5000).optional(),
    extraIgnore: z.array(z.string().min(1)).max(50).optional(),
    fullFileContext: z.boolean().default(true),
    minSeverity: z.enum(SEVERITIES).nullish(),
    repoRules: z.boolean().default(true),
    // Recorded on the review; the dialog sends the profile's settings (possibly tweaked) explicitly.
    profileId: z.string().uuid().nullish(),
    incremental: z.boolean().default(false),
    baseReviewId: z.string().uuid().nullish(),
  }),
  // A review with no AI pass, for writing comments by hand.
  z.object({ mode: z.literal("manual") }),
]);

export const POST = route<PrCtx>(async (req, { user, params }) => {
  const { connId, owner, repo, number } = await prParams(params);
  const input = body.parse(await req.json());
  const { conn, scm } = await getConnection(user.id, connId);
  const db = await getDb();

  if (input.mode === "manual") {
    const pr = await scm.getPull(owner, repo, number);
    const [row] = await db
      .insert(schema.reviews)
      .values({
        userId: user.id,
        connectionId: connId,
        owner,
        repo,
        prNumber: number,
        headSha: pr.headSha,
        baseSha: pr.baseSha,
        model: "manual",
        status: "completed",
        completedAt: new Date(),
        verdict: "comment",
      })
      .returning({ id: schema.reviews.id });
    return { id: row.id };
  }

  if (input.profileId) await getVisibleProfile(user.id, input.profileId);
  const [provider] = await db.select().from(schema.aiProviders).where(eq(schema.aiProviders.id, input.providerId)).limit(1);
  if (!provider) throw new HttpError(404, "AI provider not found");
  const id = await startReview({
    userId: user.id,
    conn,
    provider,
    owner,
    repo,
    number,
    options: {
      instructions: input.instructions,
      extraIgnore: input.extraIgnore,
      fullFileContext: input.fullFileContext,
      minSeverity: input.minSeverity ?? null,
      repoRules: input.repoRules,
      profileId: input.profileId ?? null,
      incremental: input.incremental,
      baseReviewId: input.baseReviewId ?? null,
    },
  });
  await audit(user.id, "review.start", {
    id,
    pr: `${owner}/${repo}#${number}`,
    provider: provider.name,
    model: provider.model,
    incremental: input.incremental,
  });
  return { id };
});
