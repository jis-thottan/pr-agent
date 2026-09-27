import "server-only";
import { AI_TIMEOUT_MS, AiRequestError, backoff, failure } from "./http";
import type { AiClient, ChatMessage, ChatOptions, ChatResult } from "./types";

export const GEMINI_DEFAULT_BASE = "https://generativelanguage.googleapis.com/v1beta";

export interface GeminiConfig {
  baseUrl: string;
  apiKey: string | null;
  model: string;
  temperature: number;
  jsonMode: boolean;
}

type Part = { text?: string; thought?: boolean };

/** Native Gemini API (generateContent) on Google AI Studio keys. */
export class GeminiClient implements AiClient {
  constructor(private cfg: GeminiConfig) {}

  private url(path: string) {
    return `${(this.cfg.baseUrl || GEMINI_DEFAULT_BASE).replace(/\/+$/, "")}${path}`;
  }

  private headers(): Record<string, string> {
    return { "content-type": "application/json", ...(this.cfg.apiKey ? { "x-goog-api-key": this.cfg.apiKey } : {}) };
  }

  async chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<ChatResult> {
    const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
    const body = {
      ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
      contents: messages
        .filter((m) => m.role !== "system")
        .map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
      generationConfig: {
        temperature: this.cfg.temperature,
        // maxOutputTokens is deliberately not set: on thinking models it also caps reasoning,
        // and a small cap returns an empty answer. The prompts bound the output length.
        ...(opts.json && this.cfg.jsonMode ? { responseMimeType: "application/json" } : {}),
      },
    };
    const model = this.cfg.model.replace(/^models\//, "");
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(this.url(`/models/${encodeURIComponent(model)}:generateContent`), {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(AI_TIMEOUT_MS),
      });
      if (res.ok) {
        const data = (await res.json()) as {
          candidates?: { content?: { parts?: Part[] }; finishReason?: string }[];
          promptFeedback?: { blockReason?: string };
          usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
        };
        if (data.promptFeedback?.blockReason) {
          throw new AiRequestError(422, `Gemini blocked the request (${data.promptFeedback.blockReason})`);
        }
        const candidate = data.candidates?.[0];
        const content = (candidate?.content?.parts ?? []).filter((p) => !p.thought).map((p) => p.text ?? "").join("");
        if (!content && candidate?.finishReason && candidate.finishReason !== "STOP") {
          throw new AiRequestError(422, `Gemini returned no text (finish reason ${candidate.finishReason})`);
        }
        const u = data.usageMetadata ?? {};
        return {
          content,
          promptTokens: u.promptTokenCount ?? 0,
          completionTokens: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0),
        };
      }
      if (await backoff(res, attempt)) continue;
      throw await failure(res, "Gemini");
    }
  }

  async listModels(): Promise<string[]> {
    const res = await fetch(this.url("/models?pageSize=1000"), { headers: this.headers(), signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw await failure(res, "Listing Gemini models");
    const data = (await res.json()) as { models?: { name: string; supportedGenerationMethods?: string[] }[] };
    return (data.models ?? [])
      .filter((m) => m.supportedGenerationMethods?.includes("generateContent"))
      .map((m) => m.name.replace(/^models\//, ""))
      .sort();
  }
}
