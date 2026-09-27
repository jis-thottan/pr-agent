import { eq } from "drizzle-orm";
import { getDb, schema } from "@/server/db";
import { encrypt } from "@/server/crypto";
import { audit, HttpError, route } from "@/server/http";
import { codeHostAppInput } from "@/server/scm/app-admin";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = route<Ctx>(async (req, { user, params }) => {
  const { id } = await params;
  const input = codeHostAppInput.parse(await req.json());
  const db = await getDb();
  const [existing] = await db.select().from(schema.codeHostApps).where(eq(schema.codeHostApps.id, id)).limit(1);
  if (!existing) throw new HttpError(404, "App registration not found");
  if (existing.kind !== input.kind) throw new HttpError(400, "The kind of an app registration can't change");
  await db
    .update(schema.codeHostApps)
    .set({
      name: input.name,
      baseUrl: input.baseUrl.replace(/\/+$/, ""),
      clientId: input.clientId,
      ...(input.clientSecret ? { encryptedClientSecret: encrypt(input.clientSecret) } : {}),
      ...(input.kind === "github_app"
        ? { webUrl: input.webUrl.replace(/\/+$/, ""), appId: input.appId, slug: input.slug, ...(input.privateKey ? { encryptedPrivateKey: encrypt(input.privateKey) } : {}) }
        : {}),
    })
    .where(eq(schema.codeHostApps.id, id));
  await audit(user.id, "code_host_app.update", { id });
}, { perm: "manageUsers" });

/** Deleting a registration also removes every connection made through it. */
export const DELETE = route<Ctx>(async (_req, { user, params }) => {
  const { id } = await params;
  const db = await getDb();
  await db.delete(schema.codeHostApps).where(eq(schema.codeHostApps.id, id));
  await audit(user.id, "code_host_app.delete", { id });
}, { perm: "manageUsers" });
