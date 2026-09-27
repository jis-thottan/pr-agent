import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "../db";
import { HttpError } from "../http";
import type { SessionUser } from "../auth/session";
export { publicBaseUrl } from "../url";

export async function listRules(userId: string) {
  const db = await getDb();
  return db
    .select({
      id: schema.autoReviewRules.id,
      connectionId: schema.autoReviewRules.connectionId,
      connectionName: schema.scmConnections.name,
      host: schema.scmConnections.provider,
      owner: schema.autoReviewRules.owner,
      repo: schema.autoReviewRules.repo,
      providerId: schema.autoReviewRules.providerId,
      profileId: schema.autoReviewRules.profileId,
      enabled: schema.autoReviewRules.enabled,
      onOpen: schema.autoReviewRules.onOpen,
      onPush: schema.autoReviewRules.onPush,
      skipDrafts: schema.autoReviewRules.skipDrafts,
      incremental: schema.autoReviewRules.incremental,
      lastDeliveryAt: schema.autoReviewRules.lastDeliveryAt,
      lastError: schema.autoReviewRules.lastError,
      createdAt: schema.autoReviewRules.createdAt,
    })
    .from(schema.autoReviewRules)
    .innerJoin(schema.scmConnections, eq(schema.scmConnections.id, schema.autoReviewRules.connectionId))
    .where(eq(schema.autoReviewRules.userId, userId))
    .orderBy(desc(schema.autoReviewRules.createdAt));
}

export async function getOwnedRule(user: SessionUser, id: string) {
  const db = await getDb();
  const [rule] = await db
    .select()
    .from(schema.autoReviewRules)
    .where(and(eq(schema.autoReviewRules.id, id), eq(schema.autoReviewRules.userId, user.id)))
    .limit(1);
  if (!rule) throw new HttpError(404, "Automatic review rule not found");
  return rule;
}

/** Editable settings of an automatic review rule. */
export const ruleSettings = z.object({
  providerId: z.string().uuid().nullish().transform((v) => v ?? null),
  profileId: z.string().uuid().nullish().transform((v) => v ?? null),
  enabled: z.boolean().default(true),
  onOpen: z.boolean().default(true),
  onPush: z.boolean().default(true),
  skipDrafts: z.boolean().default(true),
  incremental: z.boolean().default(true),
});

