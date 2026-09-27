"use client";

import { useEffect, useState } from "react";
import clsx from "clsx";
import { api } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { Button, Card, ErrorNote, Field, Input, Spinner } from "@/components/ui";

type Totals = { usd: number; promptTokens: number; completionTokens: number };
type Usage = {
  since: string;
  me: Totals;
  meByKind: (Totals & { kind: "review" | "chat" | "test" })[];
  userLimitUsd: number | null;
  providers: (Totals & { id: string; name: string; model: string; budgetUsd: number | null; priced: boolean })[];
  users: (Totals & { userId: string; name: string; email: string })[] | null;
};

const usd = (n: number) => `$${n < 1 && n > 0 ? n.toFixed(4) : n.toFixed(2)}`;
const tokens = (t: Totals) => `${(t.promptTokens + t.completionTokens).toLocaleString()} tokens`;

export function UsageSection({ isAdmin }: { isAdmin: boolean }) {
  const { data, loading, error, reload } = useApi<Usage>("/api/usage");
  const [limit, setLimit] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  useEffect(() => setLimit(data?.userLimitUsd?.toString() ?? ""), [data?.userLimitUsd]);

  const month = data ? new Date(data.since).toLocaleString(undefined, { month: "long", year: "numeric", timeZone: "UTC" }) : "";

  return (
    <Card title={`Usage and budgets${month ? ` · ${month}` : ""}`} actions={<Button size="sm" variant="ghost" onClick={() => reload()} loading={loading}>Refresh</Button>}>
      <ErrorNote error={error} />
      {!data ? (
        <div className="p-6 text-center"><Spinner /></div>
      ) : (
        <div className="space-y-4 p-4 text-sm">
          <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
            <div>
              <span className="text-lg font-semibold">{usd(data.me.usd)}</span>
              <span className="text-muted"> spent by you{data.userLimitUsd != null && <> of your {usd(data.userLimitUsd)} limit</>}</span>
            </div>
            <span className="text-xs text-muted">
              {tokens(data.me)} · {data.meByKind.map((k) => `${k.kind} ${usd(k.usd)}`).join(" · ") || "no AI calls yet"}
            </span>
          </div>

          <div>
            <div className="mb-1 text-xs font-medium text-muted">By provider (everyone)</div>
            <ul className="space-y-2">
              {data.providers.map((p) => {
                const pct = p.budgetUsd ? Math.min(100, (p.usd / p.budgetUsd) * 100) : 0;
                return (
                  <li key={p.id}>
                    <div className="flex items-baseline gap-2">
                      <span className="font-medium">{p.name}</span>
                      <span className="font-mono text-xs text-muted">{p.model}</span>
                      <span className="ml-auto">{p.priced ? usd(p.usd) : <span className="text-muted">not priced</span>}{p.budgetUsd != null && <span className="text-muted"> / {usd(p.budgetUsd)}</span>}</span>
                      <span className="w-32 text-right text-xs text-muted">{tokens(p)}</span>
                    </div>
                    {p.budgetUsd != null && (
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-panel-2">
                        <div className={clsx("h-full", pct >= 100 ? "bg-danger" : pct >= 80 ? "bg-warn" : "bg-accent")} style={{ width: `${pct}%` }} />
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
            <p className="mt-2 text-xs text-muted">Set prices and a monthly budget on each provider to track cost. Reviews and chats stop when a budget is reached.</p>
          </div>

          {isAdmin && data.users && (
            <div className="space-y-3 border-t border-border pt-3">
              <div className="flex flex-wrap items-end gap-2">
                <Field label="Monthly limit per user (USD)" hint="Applies to every user. Leave empty for no limit.">
                  <Input type="number" min={0} step="1" className="w-40" value={limit} onChange={(e) => setLimit(e.target.value)} placeholder="unlimited" />
                </Field>
                <Button
                  loading={saving}
                  onClick={async () => {
                    setSaving(true);
                    setSaveError(null);
                    try {
                      await api("/api/usage/settings", { method: "PUT", body: { userMonthlyUsd: limit.trim() === "" ? null : Number(limit) } });
                      reload();
                    } catch (err) {
                      setSaveError((err as Error).message);
                    } finally {
                      setSaving(false);
                    }
                  }}
                >
                  Save limit
                </Button>
              </div>
              <ErrorNote error={saveError} />
              {data.users.length > 0 && (
                <table className="w-full text-left text-xs">
                  <thead className="text-muted"><tr><th className="py-1 font-medium">User</th><th className="font-medium">Tokens</th><th className="text-right font-medium">Spent</th></tr></thead>
                  <tbody className="divide-y divide-border">
                    {data.users.map((u) => (
                      <tr key={u.userId}>
                        <td className="py-1">{u.name} <span className="text-muted">{u.email}</span></td>
                        <td>{(u.promptTokens + u.completionTokens).toLocaleString()}</td>
                        <td className="text-right">{usd(u.usd)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
