import "server-only";
import { z } from "zod";
import { AI_PROVIDER_TYPES } from "../db/schema";

export const providerInput = z.object({
  name: z.string().trim().min(1).max(100),
  type: z.enum(AI_PROVIDER_TYPES).default("openai_compatible"),
  baseUrl: z.string().trim().url(),
  // Omit to keep the existing key on update; empty string clears it.
  apiKey: z.string().optional(),
  model: z.string().trim().min(1),
  apiVersion: z
    .string()
    .trim()
    .max(40)
    .nullish()
    .transform((v) => v || null),
  temperature: z.coerce.number().min(0).max(2).default(0.1),
  maxContextTokens: z.coerce.number().int().min(2000).max(2_000_000).default(16000),
  jsonMode: z.boolean().default(true),
  isLocal: z.boolean().default(false),
  isDefault: z.boolean().default(false),
  // USD per million tokens and a monthly cap; empty means not priced / unlimited.
  inputCostPerMTok: z.coerce.number().min(0).max(10_000).nullish().transform((v) => v ?? null),
  outputCostPerMTok: z.coerce.number().min(0).max(10_000).nullish().transform((v) => v ?? null),
  monthlyBudgetUsd: z.coerce.number().min(0).max(10_000_000).nullish().transform((v) => v ?? null),
});

export type ProviderInput = z.infer<typeof providerInput>;
