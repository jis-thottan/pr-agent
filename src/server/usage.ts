import "server-only";
import { and, eq, gte, sql } from "drizzle-orm";
import { getDb, schema } from "./db";
import { HttpError } from "./http";
import type { AiProvider } from "./db/schema";
import type { AiClient, ChatMessage, ChatOptions } from "./ai/types";

export type UsageKind = "review" | "chat" | "test";

const BUDGET_SETTINGS_KEY = "budgets";
export type BudgetSettings = { userMonthlyUsd: number | null };

export class BudgetExceededError extends HttpError {
  constructor(message: string) {
    super(402, message);
  }
}

/** $12.34, or more decimals for sub-dollar amounts so small budgets don't read as $0.00. */
export function formatUsd(n: number) {
  return `$${n >= 1 || n === 0 ? n.toFixed(2) : n.toPrecision(2)}`;
}

export function costOf(p: Pick<AiProvider, "inputCostPerMTok" | "outputCostPerMTok">, promptTokens: number, completionTokens: number) {
  return ((p.inputCostPerMTok ?? 0) * promptTokens + (p.outputCostPerMTok ?? 0) * completionTokens) / 1_000_000;
}

/** First instant of the current calendar month, UTC. */
export function monthStart(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export async function getBudgetSettings(): Promise<BudgetSettings> {
  const db = await getDb();
  const [row] = await db.select().from(schema.appSettings).where(eq(schema.appSettings.key, BUDGET_SETTINGS_KEY)).limit(1);
  const v = (row?.value ?? {}) as Partial<BudgetSettings>;
  return { userMonthlyUsd: typeof v.userMonthlyUsd === "number" ? v.userMonthlyUsd : null };
}

export async function setBudgetSettings(value: BudgetSettings) {
  const db = await getDb();
  await db
    .insert(schema.appSettings)
    .values({ key: BUDGET_SETTINGS_KEY, value })
    .onConflictDoUpdate({ target: schema.appSettings.key, set: { value, updatedAt: new Date() } });
}

export async function spentThisMonth(filter: { providerId?: string; userId?: string }) {
  const db = await getDb();
  const conds = [gte(schema.aiUsage.createdAt, monthStart())];
  if (filter.providerId) conds.push(eq(schema.aiUsage.providerId, filter.providerId));
  if (filter.userId) conds.push(eq(schema.aiUsage.userId, filter.userId));
  const [row] = await db
    .select({ usd: sql<number>`coalesce(sum(${schema.aiUsage.costUsd}), 0)` })
    .from(schema.aiUsage)
    .where(and(...conds));
  return Number(row?.usd ?? 0);
}

/**
 * Throws BudgetExceededError when spending `estimatedUsd` more would pass the provider's
 * monthly budget or the per-user monthly limit.
 */
export async function checkBudget(userId: string | null, provider: AiProvider, estimatedUsd = 0) {
  if (provider.monthlyBudgetUsd != null) {
    const spent = await spentThisMonth({ providerId: provider.id });
    if (spent + estimatedUsd > provider.monthlyBudgetUsd) {
      throw new BudgetExceededError(
        `The monthly budget for ${provider.name} (${formatUsd(provider.monthlyBudgetUsd)}) would be exceeded: ` +
          `${formatUsd(spent)} spent so far${estimatedUsd ? `, about ${formatUsd(estimatedUsd)} needed` : ""}.`,
      );
    }
  }
  if (userId) {
    const { userMonthlyUsd } = await getBudgetSettings();
    if (userMonthlyUsd != null) {
      const spent = await spentThisMonth({ userId });
      if (spent + estimatedUsd > userMonthlyUsd) {
        throw new BudgetExceededError(
          `Your monthly AI limit (${formatUsd(userMonthlyUsd)}) would be exceeded: ${formatUsd(spent)} spent so far` +
            `${estimatedUsd ? `, about ${formatUsd(estimatedUsd)} needed` : ""}. An admin can raise it in Settings.`,
        );
      }
    }
  }
}

export async function recordUsage(args: {
  userId: string | null;
  provider: AiProvider;
  kind: UsageKind;
  reviewId?: string | null;
  promptTokens: number;
  completionTokens: number;
}) {
  const costUsd = costOf(args.provider, args.promptTokens, args.completionTokens);
  const db = await getDb();
  await db.insert(schema.aiUsage).values({
    userId: args.userId,
    providerId: args.provider.id === "unsaved" ? null : args.provider.id,
    reviewId: args.reviewId ?? null,
    kind: args.kind,
    model: args.provider.model,
    promptTokens: args.promptTokens,
    completionTokens: args.completionTokens,
    costUsd,
  });
  return costUsd;
}

/**
 * Wraps a client so every call is budget-checked first and recorded afterwards.
 * `onCost` lets callers keep a running total (e.g. on the review row).
 */
export function metered(
  ai: AiClient,
  ctx: { userId: string | null; provider: AiProvider; kind: UsageKind; reviewId?: string | null; onCost?: (usd: number) => Promise<void> | void },
): AiClient {
  return {
    listModels: () => ai.listModels(),
    async chat(messages: ChatMessage[], opts?: ChatOptions) {
      if (ctx.provider.id !== "unsaved") await checkBudget(ctx.userId, ctx.provider);
      const res = await ai.chat(messages, opts);
      const usd = await recordUsage({ ...ctx, promptTokens: res.promptTokens, completionTokens: res.completionTokens });
      await ctx.onCost?.(usd);
      return res;
    },
  };
}
