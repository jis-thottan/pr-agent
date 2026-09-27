import "server-only";
import { AI_TIMEOUT_MS, AiRequestError, backoff } from "./http";
import type { AiClient, ChatMessage, ChatOptions, ChatResult } from "./types";

export { AiRequestError };

export interface OpenAiCompatibleConfig {
  baseUrl: string; // e.g. https://api.openai.com/v1, http://ollama:11434/v1, http://localhost:1234/v1
  apiKey?: string | null;
  model: string;
  temperature: number;
  jsonMode: boolean;
  /**
   * Azure OpenAI "classic" deployments API: baseUrl is the resource endpoint
   * (https://NAME.openai.azure.com), model is the deployment name.
   */
  azure?: { apiVersion: string };
}

/**
 * Works with any server that implements the OpenAI Chat Completions API:
 * OpenAI, Azure AI Foundry (OpenAI v1 endpoint), Ollama, LM Studio, vLLM, LocalAI, llama.cpp,
 * OpenRouter, Groq, Together, DeepSeek, Mistral, etc. With `azure`, it targets Azure OpenAI deployments.
 */
export class OpenAiCompatibleClient implements AiClient {
  constructor(private cfg: OpenAiCompatibleConfig) {}

  private url(path: string) {
    const base = this.cfg.baseUrl.replace(/\/+$/, "");
    if (!this.cfg.azure) return `${base}${path}`;
    const root = base.replace(/\/openai(\/.*)?$/, "");
    return `${root}/openai/deployments/${encodeURIComponent(this.cfg.model)}${path}?api-version=${encodeURIComponent(this.cfg.azure.apiVersion)}`;
  }

  private get label() {
    return this.cfg.azure ? "Azure OpenAI" : "AI provider";
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { "content-type": "application/json" };
    if (this.cfg.apiKey) {
      h["api-key"] = this.cfg.apiKey; // Azure-style header; ignored elsewhere
      if (!this.cfg.azure) h.authorization = `Bearer ${this.cfg.apiKey}`;
    }
    return h;
  }

  async chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<ChatResult> {
    const wantJson = Boolean(opts.json && this.cfg.jsonMode);
    const body: Record<string, unknown> = {
      ...(this.cfg.azure ? {} : { model: this.cfg.model }),
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
        signal: AbortSignal.timeout(AI_TIMEOUT_MS),
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
      const text = await res.clone().text().catch(() => "");
      // Some servers reject response_format, max_tokens or a custom temperature; retry once without them.
      if (res.status === 400 && attempt === 0 && /response_format|json_object|max_tokens|temperature/i.test(text)) {
        delete body.response_format;
        delete body.max_tokens;
        if (/temperature/i.test(text)) delete body.temperature;
        continue;
      }
      if (await backoff(res, attempt)) continue;
      throw new AiRequestError(res.status, `${this.label} returned ${res.status}: ${text.slice(0, 500)}`);
    }
  }

  async listModels(): Promise<string[]> {
    if (this.cfg.azure) {
      throw new AiRequestError(400, "Azure OpenAI doesn't list deployments with an API key. Enter the deployment name from the Azure portal.");
    }
    const res = await fetch(this.url("/models"), {
      headers: this.headers(),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new AiRequestError(res.status, `Listing models failed (${res.status})`);
    const data = (await res.json()) as { data?: { id: string }[] };
    return (data.data ?? []).map((m) => m.id).sort();
  }
}
