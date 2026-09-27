import { z } from "zod";
import { route } from "@/server/http";
import { providerInput } from "@/server/ai/provider-input";
import { providerFromInput } from "@/server/ai/resolve";
import { aiClientFor } from "@/server/ai";
import { metered } from "@/server/usage";

const body = providerInput.extend({ id: z.string().uuid().optional() });

export const POST = route(
  async (req, { user }) => {
    const { id, ...input } = body.parse(await req.json());
    const provider = await providerFromInput(input, id);
    const client = metered(aiClientFor(provider), { userId: user.id, provider, kind: "test" });
    const started = Date.now();
    try {
      const res = await client.chat(
        [{ role: "user", content: 'Reply with the JSON object {"ok":true} and nothing else.' }],
        { json: true, maxTokens: 50 },
      );
      return { ok: true, latencyMs: Date.now() - started, reply: res.content.slice(0, 200) };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
  { admin: true },
);
