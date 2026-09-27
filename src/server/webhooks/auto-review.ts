import "server-only";
import { and, eq, ne } from "drizzle-orm";
import { getDb, schema } from "../db";
import { audit } from "../http";
import { providerFor } from "../scm";
import { startReview, ReviewError } from "../review/engine";

export type AutoReviewPayload = { ruleId: string; number: number };

async function setRuleError(ruleId: string, error: string | null) {
  const db = await getDb();
  await db.update(schema.autoReviewRules).set({ lastError: error }).where(eq(schema.autoReviewRules.id, ruleId));
}

/** Job handler for a webhook delivery: queues a draft AI review of the PR's current head, once per commit. */
export async function runAutoReview({ ruleId, number }: AutoReviewPayload) {
  const db = await getDb();
  const [rule] = await db.select().from(schema.autoReviewRules).where(eq(schema.autoReviewRules.id, ruleId)).limit(1);
  if (!rule?.enabled) return;
  try {
    const [conn] = await db.select().from(schema.scmConnections).where(eq(schema.scmConnections.id, rule.connectionId)).limit(1);
    if (!conn) throw new ReviewError("The connection for this automatic review was removed", 400);
    const pr = await providerFor(conn).getPull(rule.owner, rule.repo, number);
    if (pr.state !== "open" || (pr.draft && rule.skipDrafts)) return;

    // Hosts redeliver and send several events per push; review each head commit once.
    const [existing] = await db
      .select({ id: schema.reviews.id })
      .from(schema.reviews)
      .where(
        and(
          eq(schema.reviews.userId, rule.userId),
          eq(schema.reviews.connectionId, rule.connectionId),
          eq(schema.reviews.owner, rule.owner),
          eq(schema.reviews.repo, rule.repo),
          eq(schema.reviews.prNumber, number),
          eq(schema.reviews.headSha, pr.headSha),
          ne(schema.reviews.status, "failed"),
        ),
      )
      .limit(1);
    if (existing) return;

    const [profile] = rule.profileId
      ? await db.select().from(schema.reviewProfiles).where(eq(schema.reviewProfiles.id, rule.profileId)).limit(1)
      : [];
    const providerId = rule.providerId ?? profile?.providerId ?? null;
    const [provider] = providerId
      ? await db.select().from(schema.aiProviders).where(eq(schema.aiProviders.id, providerId)).limit(1)
      : await db.select().from(schema.aiProviders).where(eq(schema.aiProviders.isDefault, true)).limit(1);
    if (!provider) throw new ReviewError("No AI provider is available for this automatic review", 400);

    const id = await startReview({
      userId: rule.userId,
      conn,
      provider,
      owner: rule.owner,
      repo: rule.repo,
      number,
      trigger: "webhook",
      autoRuleId: rule.id,
      options: {
        instructions: profile?.instructions ?? null,
        extraIgnore: profile?.extraIgnore ?? [],
        fullFileContext: profile?.fullFileContext ?? true,
        minSeverity: profile?.minSeverity ?? null,
        profileId: profile?.id ?? null,
        repoRules: true,
        incremental: rule.incremental,
      },
    });
    await setRuleError(rule.id, null);
    await audit(rule.userId, "review.auto_start", { id, rule: rule.id, pr: `${rule.owner}/${rule.repo}#${number}`, head: pr.headSha });
  } catch (err) {
    await setRuleError(rule.id, err instanceof Error ? err.message : String(err));
    throw err;
  }
}
