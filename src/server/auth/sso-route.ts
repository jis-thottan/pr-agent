import "server-only";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "../db";

export async function enabledSsoProvider(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const db = await getDb();
  const [p] = await db
    .select()
    .from(schema.ssoProviders)
    .where(and(eq(schema.ssoProviders.id, id), eq(schema.ssoProviders.enabled, true)))
    .limit(1);
  return p ?? null;
}

export function loginErrorRedirect(base: string, message: string) {
  return `${base}/login?error=${encodeURIComponent(message)}`;
}
