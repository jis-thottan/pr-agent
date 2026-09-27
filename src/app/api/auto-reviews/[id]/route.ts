import { eq } from "drizzle-orm";
import { getDb, schema } from "@/server/db";
import { audit, route } from "@/server/http";
import { assertProviderExists, getVisibleProfile } from "@/server/profiles";
import { getOwnedRule, ruleSettings } from "@/server/webhooks/rules";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = route<Ctx>(async (req, { user, params }) => {
  const { id } = await params;
  await getOwnedRule(user, id);
  const input = ruleSettings.parse(await req.json());
  await assertProviderExists(input.providerId);
  if (input.profileId) await getVisibleProfile(user.id, input.profileId);
  const db = await getDb();
  await db.update(schema.autoReviewRules).set(input).where(eq(schema.autoReviewRules.id, id));
  await audit(user.id, "auto_review.update", { id, enabled: input.enabled });
}, { perm: "autoReview" });

export const DELETE = route<Ctx>(async (_req, { user, params }) => {
  const { id } = await params;
  await getOwnedRule(user, id);
  const db = await getDb();
  await db.delete(schema.autoReviewRules).where(eq(schema.autoReviewRules.id, id));
  await audit(user.id, "auto_review.delete", { id });
}, { perm: "autoReview" });
