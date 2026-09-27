import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { AI_TIMEOUT_MS, AiRequestError } from "./http";
import type { AiClient, ChatMessage, ChatOptions, ChatResult } from "./types";

export interface AnthropicConfig {
  baseUrl: string;
  apiKey: string | null;
  model: string;
}

/** Room for adaptive thinking plus the answer; callers' smaller maxTokens hints are raised to this. */
const MIN_MAX_TOKENS = 16_000;

/**
 * Native Claude Messages API via the official SDK.
 * Temperature is not sent (current Claude models reject sampling parameters) and there is no
 * assistant prefill; JSON shape comes from the prompt, and the parser tolerates stray prose.
 */
export class AnthropicClient implements AiClient {
  private client: Anthropic;

  constructor(private cfg: AnthropicConfig) {
    this.client = new Anthropic({
      apiKey: cfg.apiKey ?? undefined,
      baseURL: cfg.baseUrl.replace(/\/+$/, "").replace(/\/v1$/, "") || undefined,
      timeout: AI_TIMEOUT_MS,
      maxRetries: 2,
    });
  }

  async chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<ChatResult> {
    const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
    try {
      const res = await this.client.messages.create({
        model: this.cfg.model,
        max_tokens: Math.max(opts.maxTokens ?? 0, MIN_MAX_TOKENS),
        ...(system ? { system } : {}),
        messages: messages
          .filter((m) => m.role !== "system")
          .map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
      });
      if (res.stop_reason === "refusal") {
        throw new AiRequestError(422, `Claude declined this request${res.stop_details?.category ? ` (${res.stop_details.category})` : ""}`);
      }
      let content = "";
      for (const block of res.content) if (block.type === "text") content += block.text;
      return { content, promptTokens: res.usage.input_tokens, completionTokens: res.usage.output_tokens };
    } catch (err) {
      if (err instanceof Anthropic.APIError) {
        throw new AiRequestError(err.status ?? 500, `Anthropic returned ${err.status ?? "an error"}: ${err.message}`);
      }
      throw err;
    }
  }

  async listModels(): Promise<string[]> {
    const ids: string[] = [];
    try {
      for await (const m of this.client.models.list()) ids.push(m.id);
    } catch (err) {
      if (err instanceof Anthropic.APIError) throw new AiRequestError(err.status ?? 500, `Listing Anthropic models failed: ${err.message}`);
      throw err;
    }
    return ids;
  }
}
