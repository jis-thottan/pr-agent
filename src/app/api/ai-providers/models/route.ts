import { z } from "zod";
import { route } from "@/server/http";
import { providerInput } from "@/server/ai/provider-input";
import { providerFromInput } from "@/server/ai/resolve";
import { aiClientFor } from "@/server/ai";

const body = providerInput.extend({ id: z.string().uuid().optional(), model: z.string().default("unused") });

export const POST = route(
  async (req) => {
    const { id, ...input } = body.parse(await req.json());
    try {
      return { models: await aiClientFor(await providerFromInput(input, id)).listModels() };
    } catch (err) {
      return { models: [], error: err instanceof Error ? err.message : String(err) };
    }
  },
  { perm: "manageProviders" },
);
