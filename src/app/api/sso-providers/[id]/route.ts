import { eq } from "drizzle-orm";
import { getDb, schema } from "@/server/db";
import { encrypt } from "@/server/crypto";
import { audit, route } from "@/server/http";
import { ssoInput } from "@/server/auth/sso-admin";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = route<Ctx>(async (req, { user, params }) => {
  const { id } = await params;
  const { clientSecret, ...input } = ssoInput.parse(await req.json());
  const db = await getDb();
  await db
    .update(schema.ssoProviders)
    .set({ ...input, ...(clientSecret ? { encryptedClientSecret: encrypt(clientSecret) } : {}) })
    .where(eq(schema.ssoProviders.id, id));
  await audit(user.id, "sso.update", { id, enabled: input.enabled });
}, { perm: "manageUsers" });

export const DELETE = route<Ctx>(async (_req, { user, params }) => {
  const { id } = await params;
  const db = await getDb();
  await db.delete(schema.ssoProviders).where(eq(schema.ssoProviders.id, id));
  await audit(user.id, "sso.delete", { id });
}, { perm: "manageUsers" });
