import { eq } from "drizzle-orm";
import { getDb, schema } from "@/server/db";
import { audit, route } from "@/server/http";
import { assertCanShare, assertProviderExists, getEditableProfile, profileInput } from "@/server/profiles";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = route<Ctx>(async (req, { user, params }) => {
  const { id } = await params;
  await getEditableProfile(user, id);
  const input = profileInput.parse(await req.json());
  await assertProviderExists(input.providerId);
  assertCanShare(user, input.shared);
  const db = await getDb();
  await db.update(schema.reviewProfiles).set({ ...input, updatedAt: new Date() }).where(eq(schema.reviewProfiles.id, id));
  await audit(user.id, "review_profile.update", { id });
});

export const DELETE = route<Ctx>(async (_req, { user, params }) => {
  const { id } = await params;
  await getEditableProfile(user, id);
  const db = await getDb();
  await db.delete(schema.reviewProfiles).where(eq(schema.reviewProfiles.id, id));
  await audit(user.id, "review_profile.delete", { id });
});
