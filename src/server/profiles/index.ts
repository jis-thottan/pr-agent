import "server-only";
import { and, asc, eq, or } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "../db";
import { HttpError } from "../http";
import { SEVERITIES } from "../db/schema";
import type { SessionUser } from "../auth/session";
import { can } from "@/lib/permissions";

export const profileInput = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).nullish().transform((v) => v || null),
  shared: z.boolean().default(false),
  providerId: z.string().uuid().nullish().transform((v) => v ?? null),
  instructions: z.string().max(5000).nullish().transform((v) => v?.trim() || null),
  extraIgnore: z.array(z.string().trim().min(1)).max(50).default([]),
  fullFileContext: z.boolean().default(true),
  minSeverity: z.enum(SEVERITIES).nullish().transform((v) => v ?? null),
});

/** Profiles the user can use: their own plus every shared one. */
export async function listVisibleProfiles(userId: string) {
  const db = await getDb();
  return db
    .select({
      id: schema.reviewProfiles.id,
      userId: schema.reviewProfiles.userId,
      ownerName: schema.users.name,
      name: schema.reviewProfiles.name,
      description: schema.reviewProfiles.description,
      shared: schema.reviewProfiles.shared,
      providerId: schema.reviewProfiles.providerId,
      instructions: schema.reviewProfiles.instructions,
      extraIgnore: schema.reviewProfiles.extraIgnore,
      fullFileContext: schema.reviewProfiles.fullFileContext,
      minSeverity: schema.reviewProfiles.minSeverity,
      updatedAt: schema.reviewProfiles.updatedAt,
    })
    .from(schema.reviewProfiles)
    .innerJoin(schema.users, eq(schema.users.id, schema.reviewProfiles.userId))
    .where(or(eq(schema.reviewProfiles.userId, userId), eq(schema.reviewProfiles.shared, true)))
    .orderBy(asc(schema.reviewProfiles.name));
}

export async function getVisibleProfile(userId: string, id: string) {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(schema.reviewProfiles)
    .where(and(eq(schema.reviewProfiles.id, id), or(eq(schema.reviewProfiles.userId, userId), eq(schema.reviewProfiles.shared, true))))
    .limit(1);
  if (!row) throw new HttpError(404, "Review profile not found");
  return row;
}

/** Owners edit their own profiles; leads and admins can also edit or delete shared ones. */
export async function getEditableProfile(user: SessionUser, id: string) {
  const row = await getVisibleProfile(user.id, id);
  if (row.userId !== user.id && !can(user.role, "shareProfiles")) {
    throw new HttpError(403, "Only the owner, a lead or an admin can change this profile");
  }
  return row;
}

export function assertCanShare(user: SessionUser, shared: boolean) {
  if (shared && !can(user.role, "shareProfiles")) throw new HttpError(403, "Only leads and admins can share profiles with everyone");
}

export async function assertProviderExists(providerId: string | null) {
  if (!providerId) return;
  const db = await getDb();
  const [row] = await db.select({ id: schema.aiProviders.id }).from(schema.aiProviders).where(eq(schema.aiProviders.id, providerId)).limit(1);
  if (!row) throw new HttpError(400, "That AI provider no longer exists");
}
