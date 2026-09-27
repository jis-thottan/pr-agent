import { and, asc, eq, gte, sql } from "drizzle-orm";
import { getDb, schema } from "@/server/db";
import { route } from "@/server/http";
import { getBudgetSettings, monthStart } from "@/server/usage";
import { can } from "@/lib/permissions";

/** Month-to-date spend: the caller's own, per provider (with budgets), and per user for admins. */
export const GET = route(async (_req, { user }) => {
  const db = await getDb();
  const since = monthStart();
  const inMonth = gte(schema.aiUsage.createdAt, since);
  const sums = {
    usd: sql<number>`coalesce(sum(${schema.aiUsage.costUsd}), 0)`,
    promptTokens: sql<number>`coalesce(sum(${schema.aiUsage.promptTokens}), 0)::bigint`,
    completionTokens: sql<number>`coalesce(sum(${schema.aiUsage.completionTokens}), 0)::bigint`,
  };
  const num = <T extends { usd: number; promptTokens: number; completionTokens: number }>(r: T) => ({
    ...r,
    usd: Number(r.usd),
    promptTokens: Number(r.promptTokens),
    completionTokens: Number(r.completionTokens),
  });

  const [mine] = await db.select(sums).from(schema.aiUsage).where(and(inMonth, eq(schema.aiUsage.userId, user.id)));
  const mineByKind = await db
    .select({ kind: schema.aiUsage.kind, ...sums })
    .from(schema.aiUsage)
    .where(and(inMonth, eq(schema.aiUsage.userId, user.id)))
    .groupBy(schema.aiUsage.kind);
  const providerSpend = await db
    .select({ providerId: schema.aiUsage.providerId, ...sums })
    .from(schema.aiUsage)
    .where(inMonth)
    .groupBy(schema.aiUsage.providerId);
  const providers = await db
    .select({
      id: schema.aiProviders.id,
      name: schema.aiProviders.name,
      model: schema.aiProviders.model,
      budgetUsd: schema.aiProviders.monthlyBudgetUsd,
      inputCostPerMTok: schema.aiProviders.inputCostPerMTok,
      outputCostPerMTok: schema.aiProviders.outputCostPerMTok,
    })
    .from(schema.aiProviders)
    .orderBy(asc(schema.aiProviders.name));

  const users =
    can(user.role, "manageBudgets")
      ? (
          await db
            .select({ userId: schema.users.id, name: schema.users.name, email: schema.users.email, ...sums })
            .from(schema.aiUsage)
            .innerJoin(schema.users, eq(schema.users.id, schema.aiUsage.userId))
            .where(inMonth)
            .groupBy(schema.users.id, schema.users.name, schema.users.email)
        )
          .map(num)
          .sort((a, b) => b.usd - a.usd)
      : null;

  return {
    since: since.toISOString(),
    me: num(mine ?? { usd: 0, promptTokens: 0, completionTokens: 0 }),
    meByKind: mineByKind.map(num),
    userLimitUsd: (await getBudgetSettings()).userMonthlyUsd,
    providers: providers.map((p) => {
      const s = providerSpend.find((x) => x.providerId === p.id);
      return { ...p, ...(s ? num(s) : { usd: 0, promptTokens: 0, completionTokens: 0 }), priced: p.inputCostPerMTok != null || p.outputCostPerMTok != null };
    }),
    users,
  };
});
