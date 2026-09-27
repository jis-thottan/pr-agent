import { getDb, schema } from "@/server/db";
import { audit, route } from "@/server/http";
import { assertCanShare, assertProviderExists, listVisibleProfiles, profileInput } from "@/server/profiles";

export const GET = route(async (_req, { user }) => ({ profiles: await listVisibleProfiles(user.id) }));

export const POST = route(async (req, { user }) => {
  const input = profileInput.parse(await req.json());
  await assertProviderExists(input.providerId);
  assertCanShare(user, input.shared);
  const db = await getDb();
  const [{ id }] = await db
    .insert(schema.reviewProfiles)
    .values({ ...input, userId: user.id })
    .returning({ id: schema.reviewProfiles.id });
  await audit(user.id, "review_profile.create", { id, name: input.name, shared: input.shared });
  return { id };
});
