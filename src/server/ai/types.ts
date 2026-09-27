export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatResult {
  content: string;
  promptTokens: number;
  completionTokens: number;
}

export interface ChatOptions {
  /** Ask for a JSON object response when the provider supports it. */
  json?: boolean;
  maxTokens?: number;
}

/** One implementation per provider family (OpenAI-compatible, Azure OpenAI, Anthropic, Gemini). */
export interface AiClient {
  chat(messages: ChatMessage[], opts?: ChatOptions): Promise<ChatResult>;
  listModels(): Promise<string[]>;
}
