import "server-only";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../db";

const KEY = "auth";

export type AuthSettings = {
  /** When false, only admins may sign in with a password (break-glass); everyone else uses SSO. */
  localLogin: boolean;
};

export async function getAuthSettings(): Promise<AuthSettings> {
  const db = await getDb();
  const [row] = await db.select().from(schema.appSettings).where(eq(schema.appSettings.key, KEY)).limit(1);
  const v = (row?.value ?? {}) as Partial<AuthSettings>;
  return { localLogin: v.localLogin !== false };
}

export async function setAuthSettings(value: AuthSettings) {
  const db = await getDb();
  await db
    .insert(schema.appSettings)
    .values({ key: KEY, value })
    .onConflictDoUpdate({ target: schema.appSettings.key, set: { value, updatedAt: new Date() } });
}
