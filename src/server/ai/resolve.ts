import "server-only";
import { asc, eq } from "drizzle-orm";
import { getDb, schema } from "../db";
import { encrypt } from "../crypto";
import type { AiProvider } from "../db/schema";
import type { ProviderInput } from "./provider-input";

/** Builds a provider from unsaved form input, falling back to the stored key when editing. */
export async function providerFromInput(input: ProviderInput, existingId?: string): Promise<AiProvider> {
  let encryptedApiKey: string | null = input.apiKey ? encrypt(input.apiKey) : null;
  if (input.apiKey === undefined && existingId) {
    const db = await getDb();
    const [row] = await db.select().from(schema.aiProviders).where(eq(schema.aiProviders.id, existingId)).limit(1);
    encryptedApiKey = row?.encryptedApiKey ?? null;
  }
  const { apiKey: _ignored, ...rest } = input;
  return { ...rest, id: existingId ?? "unsaved", encryptedApiKey, createdAt: new Date() };
}

/** Public shape (never includes the API key). */
export async function listProviders() {
  const db = await getDb();
  const rows = await db.select().from(schema.aiProviders).orderBy(asc(schema.aiProviders.name));
  return rows.map(({ encryptedApiKey, ...p }) => ({ ...p, hasApiKey: Boolean(encryptedApiKey) }));
}

