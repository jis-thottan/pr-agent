import "server-only";
import { decrypt } from "../crypto";
import type { AiProvider } from "../db/schema";
import { OpenAiCompatibleClient } from "./openai-compatible";
import type { AiClient } from "./types";

export function aiClientFor(p: AiProvider): AiClient {
  switch (p.type) {
    case "openai_compatible":
      return new OpenAiCompatibleClient({
        baseUrl: p.baseUrl,
        apiKey: p.encryptedApiKey ? decrypt(p.encryptedApiKey) : null,
        model: p.model,
        temperature: p.temperature,
        jsonMode: p.jsonMode,
      });
  }
}
