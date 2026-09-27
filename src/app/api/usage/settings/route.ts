import { z } from "zod";
import { audit, route } from "@/server/http";
import { setBudgetSettings } from "@/server/usage";

const body = z.object({ userMonthlyUsd: z.number().min(0).max(10_000_000).nullable() });

export const PUT = route(
  async (req, { user }) => {
    const input = body.parse(await req.json());
    await setBudgetSettings(input);
    await audit(user.id, "budget.update", input);
  },
  { admin: true },
);
