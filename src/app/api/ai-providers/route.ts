import { getDb, schema } from "@/server/db";
import { encrypt } from "@/server/crypto";
import { audit, route } from "@/server/http";
import { providerInput } from "@/server/ai/provider-input";
import { listProviders } from "@/server/ai/resolve";

export const GET = route(async () => ({ providers: await listProviders() }));

export const POST = route(
  async (req, { user }) => {
    const { apiKey, ...input } = providerInput.parse(await req.json());
    const db = await getDb();
    const [{ id }] = await db.transaction(async (tx) => {
      if (input.isDefault) await tx.update(schema.aiProviders).set({ isDefault: false });
      const existing = await tx.select({ id: schema.aiProviders.id }).from(schema.aiProviders).limit(1);
      return tx
        .insert(schema.aiProviders)
        .values({ ...input, isDefault: input.isDefault || existing.length === 0, encryptedApiKey: apiKey ? encrypt(apiKey) : null })
        .returning({ id: schema.aiProviders.id });
    });
    await audit(user.id, "ai_provider.create", { id, name: input.name, model: input.model });
    return { id };
  },
  { admin: true },
);
