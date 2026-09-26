import { eq } from "drizzle-orm";
import { getDb, schema } from "@/server/db";
import { encrypt } from "@/server/crypto";
import { audit, route } from "@/server/http";
import { providerInput } from "@/server/ai/provider-input";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = route<Ctx>(
  async (req, { user, params }) => {
    const { id } = await params;
    const { apiKey, ...input } = providerInput.parse(await req.json());
    const db = await getDb();
    await db.transaction(async (tx) => {
      if (input.isDefault) await tx.update(schema.aiProviders).set({ isDefault: false });
      await tx
        .update(schema.aiProviders)
        .set({
          ...input,
          ...(apiKey !== undefined ? { encryptedApiKey: apiKey ? encrypt(apiKey) : null } : {}),
        })
        .where(eq(schema.aiProviders.id, id));
    });
    await audit(user.id, "ai_provider.update", { id });
  },
  { admin: true },
);

export const DELETE = route<Ctx>(
  async (_req, { user, params }) => {
    const { id } = await params;
    const db = await getDb();
    await db.delete(schema.aiProviders).where(eq(schema.aiProviders.id, id));
    await audit(user.id, "ai_provider.delete", { id });
  },
  { admin: true },
);
