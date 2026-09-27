import { asc } from "drizzle-orm";
import { getDb, schema } from "@/server/db";
import { encrypt } from "@/server/crypto";
import { audit, HttpError, route } from "@/server/http";
import { can } from "@/lib/permissions";
import { codeHostAppInput } from "@/server/scm/app-admin";
import { publicBaseUrl } from "@/server/url";

/** Everyone can list registrations (to connect with them); secrets are never returned. */
export const GET = route(async (req, { user }) => {
  const db = await getDb();
  const rows = await db.select().from(schema.codeHostApps).orderBy(asc(schema.codeHostApps.name));
  const base = publicBaseUrl(req);
  return {
    apps: rows.map((a) => ({
      id: a.id,
      kind: a.kind,
      name: a.name,
      baseUrl: a.baseUrl,
      webUrl: a.webUrl,
      ...(can(user.role, "manageUsers")
        ? { appId: a.appId, slug: a.slug, clientId: a.clientId, hasPrivateKey: Boolean(a.encryptedPrivateKey), callbackUrl: `${base}/api/code-host-apps/${a.id}/callback` }
        : {}),
    })),
    publicUrlSet: Boolean(process.env.PUBLIC_URL),
  };
});

export const POST = route(async (req, { user }) => {
  const input = codeHostAppInput.parse(await req.json());
  if (!input.clientSecret) throw new HttpError(400, "clientSecret: required");
  if (input.kind === "github_app" && !input.privateKey) throw new HttpError(400, "privateKey: required");
  const db = await getDb();
  const [row] = await db
    .insert(schema.codeHostApps)
    .values({
      kind: input.kind,
      name: input.name,
      baseUrl: input.baseUrl.replace(/\/+$/, ""),
      clientId: input.clientId,
      encryptedClientSecret: encrypt(input.clientSecret),
      ...(input.kind === "github_app"
        ? { webUrl: input.webUrl.replace(/\/+$/, ""), appId: input.appId, slug: input.slug, encryptedPrivateKey: encrypt(input.privateKey!) }
        : {}),
    })
    .returning({ id: schema.codeHostApps.id });
  await audit(user.id, "code_host_app.create", { id: row.id, kind: input.kind, name: input.name });
  return { id: row.id, callbackUrl: `${publicBaseUrl(req)}/api/code-host-apps/${row.id}/callback` };
}, { perm: "manageUsers" });
