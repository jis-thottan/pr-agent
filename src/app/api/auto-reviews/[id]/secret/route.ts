import { eq } from "drizzle-orm";
import { getDb, schema } from "@/server/db";
import { decrypt, encrypt, randomToken } from "@/server/crypto";
import { audit, route } from "@/server/http";
import { getOwnedRule } from "@/server/webhooks/rules";

type Ctx = { params: Promise<{ id: string }> };

/** Reveals the webhook secret to its owner (needed to configure the code host). */
export const GET = route<Ctx>(async (_req, { user, params }) => {
  const { id } = await params;
  const rule = await getOwnedRule(user, id);
  return { secret: decrypt(rule.encryptedSecret) };
});

/** Rotates the secret; the code host must be updated with the new one. */
export const POST = route<Ctx>(async (_req, { user, params }) => {
  const { id } = await params;
  await getOwnedRule(user, id);
  const secret = randomToken(24);
  const db = await getDb();
  await db.update(schema.autoReviewRules).set({ encryptedSecret: encrypt(secret) }).where(eq(schema.autoReviewRules.id, id));
  await audit(user.id, "auto_review.rotate_secret", { id });
  return { secret };
});
