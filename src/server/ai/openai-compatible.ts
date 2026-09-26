import "server-only";
import type { AiClient, ChatMessage, ChatOptions, ChatResult } from "./types";

export interface OpenAiCompatibleConfig {
  baseUrl: string; // e.g. https://api.openai.com/v1, http://ollama:11434/v1, http://localhost:1234/v1
  apiKey?: string | null;
  model: string;
  temperature: number;
  jsonMode: boolean;
}

const TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS ?? 300_000);

export class AiRequestError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Works with any server that implements the OpenAI Chat Completions API:
 * OpenAI, Azure AI Foundry (OpenAI v1 endpoint), Ollama, LM Studio, vLLM, LocalAI, llama.cpp,
 * OpenRouter, Groq, Together, DeepSeek, Mistral, etc.
 */
export class OpenAiCompatibleClient implements AiClient {
  constructor(private cfg: OpenAiCompatibleConfig) {}

  private url(path: string) {
    return `${this.cfg.baseUrl.replace(/\/+$/, "")}${path}`;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { "content-type": "application/json" };
    if (this.cfg.apiKey) {
      h.authorization = `Bearer ${this.cfg.apiKey}`;
      h["api-key"] = this.cfg.apiKey; // Azure-style header; ignored elsewhere
    }
    return h;
  }

  async chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<ChatResult> {
    const wantJson = Boolean(opts.json && this.cfg.jsonMode);
    const body: Record<string, unknown> = {
      model: this.cfg.model,
      messages,
      temperature: this.cfg.temperature,
      stream: false,
      ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}),
      ...(wantJson ? { response_format: { type: "json_object" } } : {}),
    };

    for (let attempt = 0; ; attempt++) {
      const res = await fetch(this.url("/chat/completions"), {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (res.ok) {
        const data = (await res.json()) as {
          choices?: { message?: { content?: string | null; reasoning_content?: string } }[];
          usage?: { prompt_tokens?: number; completion_tokens?: number };
        };
        return {
          content: data.choices?.[0]?.message?.content ?? "",
          promptTokens: data.usage?.prompt_tokens ?? 0,
          completionTokens: data.usage?.completion_tokens ?? 0,
        };
      }
      const text = await res.text().catch(() => "");
      // Some servers reject response_format or max_tokens; retry once without them.
      if (res.status === 400 && attempt === 0 && /response_format|json_object|max_tokens/i.test(text)) {
        delete body.response_format;
        delete body.max_tokens;
        continue;
      }
      if ((res.status === 429 || res.status >= 500) && attempt < 2) {
        const retryAfter = Number(res.headers.get("retry-after")) || 2 ** attempt * 2;
        await new Promise((r) => setTimeout(r, Math.min(retryAfter, 30) * 1000));
        continue;
      }
      throw new AiRequestError(res.status, `AI provider returned ${res.status}: ${text.slice(0, 500)}`);
    }
  }

  async listModels(): Promise<string[]> {
    const res = await fetch(this.url("/models"), {
      headers: this.headers(),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new AiRequestError(res.status, `Listing models failed (${res.status})`);
    const data = (await res.json()) as { data?: { id: string }[] };
    return (data.data ?? []).map((m) => m.id).sort();
  }
}
