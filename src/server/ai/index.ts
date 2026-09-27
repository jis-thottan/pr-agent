import "server-only";
import { decrypt } from "../crypto";
import type { AiProvider } from "../db/schema";
import { AnthropicClient } from "./anthropic";
import { GeminiClient } from "./gemini";
import { OpenAiCompatibleClient } from "./openai-compatible";
import type { AiClient } from "./types";

export const AZURE_DEFAULT_API_VERSION = "2024-10-21";

export function aiClientFor(p: AiProvider): AiClient {
  const apiKey = p.encryptedApiKey ? decrypt(p.encryptedApiKey) : null;
  switch (p.type) {
    case "openai_compatible":
      return new OpenAiCompatibleClient({ baseUrl: p.baseUrl, apiKey, model: p.model, temperature: p.temperature, jsonMode: p.jsonMode });
    case "azure_openai":
      return new OpenAiCompatibleClient({
        baseUrl: p.baseUrl,
        apiKey,
        model: p.model,
        temperature: p.temperature,
        jsonMode: p.jsonMode,
        azure: { apiVersion: p.apiVersion || AZURE_DEFAULT_API_VERSION },
      });
    case "anthropic":
      return new AnthropicClient({ baseUrl: p.baseUrl, apiKey, model: p.model });
    case "gemini":
      return new GeminiClient({ baseUrl: p.baseUrl, apiKey, model: p.model, temperature: p.temperature, jsonMode: p.jsonMode });
  }
}
