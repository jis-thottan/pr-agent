import { asc } from "drizzle-orm";
import { getDb, schema } from "@/server/db";
import { encrypt } from "@/server/crypto";
import { audit, HttpError, route } from "@/server/http";
import { issuerForForm, ssoInput } from "@/server/auth/sso-admin";
import { ssoRedirectUri } from "@/server/auth/sso";
import { getAuthSettings } from "@/server/auth/settings";
import { publicBaseUrl } from "@/server/url";

export const GET = route(async (req) => {
  const db = await getDb();
  const rows = await db.select().from(schema.ssoProviders).orderBy(asc(schema.ssoProviders.name));
  const base = publicBaseUrl(req);
  return {
    providers: rows.map(({ encryptedClientSecret: _s, ...p }) => ({ ...p, issuerInput: issuerForForm(p.kind, p.issuer), redirectUri: ssoRedirectUri(base, p.id) })),
    callbackBase: `${base}/api/auth/sso/<id>/callback`,
    publicUrlSet: Boolean(process.env.PUBLIC_URL),
    settings: await getAuthSettings(),
  };
}, { perm: "manageUsers" });

export const POST = route(async (req, { user }) => {
  const { clientSecret, ...input } = ssoInput.parse(await req.json());
  if (!clientSecret) throw new HttpError(400, "clientSecret: required");
  const db = await getDb();
  const [row] = await db
    .insert(schema.ssoProviders)
    .values({ ...input, encryptedClientSecret: encrypt(clientSecret) })
    .returning({ id: schema.ssoProviders.id });
  await audit(user.id, "sso.create", { id: row.id, kind: input.kind, name: input.name });
  return { id: row.id, redirectUri: ssoRedirectUri(publicBaseUrl(req), row.id) };
}, { perm: "manageUsers" });
