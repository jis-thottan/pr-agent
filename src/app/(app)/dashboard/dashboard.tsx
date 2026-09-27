"use client";

import { useState } from "react";
import clsx from "clsx";
import { useApi } from "@/lib/hooks";
import { Card, Empty, ErrorNote, Spinner } from "@/components/ui";

type Stats = { reviews: number; posted: number; findings: number; critical: number; acceptanceRate: number | null; costUsd: number };
type Dashboard = {
  days: number;
  since: string;
  truncated: boolean;
  chatCostUsd: number;
  totals: {
    reviews: number;
    automatic: number;
    incremental: number;
    completed: number;
    failed: number;
    posted: number;
    findings: number;
    pendingFindings: number;
    acceptanceRate: number | null;
    medianMinutesToPost: number | null;
    costUsd: number;
  };
  severity: Record<string, number>;
  category: Record<string, number>;
  daily: { day: string; reviews: number; posted: number }[];
  repos: (Stats & { repo: string })[];
  reviewers: (Stats & { userId: string; name: string })[];
};

const compact = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });
const pct = (r: number | null) => (r == null ? "–" : `${Math.round(r * 100)}%`);
const money = (n: number) => (n === 0 ? "$0" : n < 1 ? `$${n.toFixed(3)}` : `$${n.toFixed(2)}`);
function duration(min: number | null) {
  if (min == null) return "–";
  if (min < 60) return `${Math.round(min)} min`;
  if (min < 48 * 60) return `${(min / 60).toFixed(1)} h`;
  return `${(min / 1440).toFixed(1)} d`;
}
const shortDay = (iso: string) => new Date(iso + "T00:00:00Z").toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });

const SEVERITY: { key: string; label: string; bar: string }[] = [
  { key: "critical", label: "Critical", bar: "bg-danger" },
  { key: "major", label: "Major", bar: "bg-warn" },
  { key: "minor", label: "Minor", bar: "bg-accent" },
  { key: "nit", label: "Nit", bar: "bg-muted" },
];

export function DashboardView() {
  const [days, setDays] = useState(30);
  const { data, loading, error } = useApi<Dashboard>(`/api/dashboard?days=${days}`);

  return (
    <main className="mx-auto w-full max-w-6xl space-y-4 p-6">
      <div className="flex flex-wrap items-center gap-3">
        <div className="mr-auto">
          <h1 className="text-xl font-semibold">Team dashboard</h1>
          <p className="text-sm text-muted">AI reviews across everyone on this server. Days are UTC.</p>
        </div>
        <div className="flex rounded-md border border-border" role="group" aria-label="Time range">
          {[7, 30, 90].map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              aria-pressed={days === d}
              className={clsx("px-3 py-1 text-sm first:rounded-l-md last:rounded-r-md", days === d ? "bg-panel-2 font-medium" : "text-muted hover:text-fg")}
            >
              {d} days
            </button>
          ))}
        </div>
        {loading && <Spinner />}
      </div>
      <ErrorNote error={error} />
      {!data ? (
        !error && <div className="p-10 text-center"><Spinner /></div>
      ) : !data.totals.reviews ? (
        <Card><Empty title="No AI reviews in this period">Reviews appear here once people run them, or when automatic reviews are triggered by webhooks.</Empty></Card>
      ) : (
        <>
          {data.truncated && <p className="text-xs text-warn">Showing the first 5,000 reviews in this period.</p>}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <Tile label="AI reviews" value={compact.format(data.totals.reviews)} note={`${data.totals.automatic} automatic · ${data.totals.incremental} incremental`} />
            <Tile label="Posted to the PR" value={compact.format(data.totals.posted)} note={`${data.totals.failed} failed`} />
            <Tile label="Findings accepted" value={pct(data.totals.acceptanceRate)} note={`of decided findings · ${compact.format(data.totals.pendingFindings)} undecided`} />
            <Tile label="Median time to post" value={duration(data.totals.medianMinutesToPost)} note="review finished → posted" />
            <Tile label="AI spend" value={money(data.totals.costUsd + data.chatCostUsd)} note={`reviews ${money(data.totals.costUsd)} · chat ${money(data.chatCostUsd)}`} />
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <Card title="Reviews per day" className="lg:col-span-2">
              <DailyChart daily={data.daily} />
            </Card>
            <Card title="Findings by severity">
              <SeverityBars severity={data.severity} total={data.totals.findings} />
            </Card>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card title="Repositories">
              <StatsTable rows={data.repos.map((r) => ({ key: r.repo, label: r.repo, ...r }))} first="Repository" />
            </Card>
            <Card title="Reviewers">
              <StatsTable rows={data.reviewers.map((r) => ({ key: r.userId, label: r.name, ...r }))} first="Reviewer" />
            </Card>
          </div>
        </>
      )}
    </main>
  );
}

function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-lg border border-border bg-bg px-4 py-3">
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
      {note && <div className="mt-0.5 truncate text-xs text-muted" title={note}>{note}</div>}
    </div>
  );
}

/** Single-series bar chart: one column per day, 2px gaps, 4px rounded tops, per-column hover/focus tooltip. */
function DailyChart({ daily }: { daily: Dashboard["daily"] }) {
  const [active, setActive] = useState<number | null>(null);
  const max = Math.max(1, ...daily.map((d) => d.reviews));
  const H = 160;
  const hovered = active != null ? daily[active] : null;

  return (
    <div className="p-4">
      <div className="relative">
        <div className="absolute -top-1 left-0 text-[11px] text-muted">{max}</div>
        <div className="flex items-end border-b border-border pl-6" style={{ height: H, gap: 2 }} onPointerLeave={() => setActive(null)}>
          {daily.map((d, i) => (
            <button
              key={d.day}
              type="button"
              className="group relative flex h-full min-w-0 flex-1 items-end focus:outline-none"
              onPointerEnter={() => setActive(i)}
              onFocus={() => setActive(i)}
              onBlur={() => setActive(null)}
              aria-label={`${shortDay(d.day)}: ${d.reviews} reviews, ${d.posted} posted`}
            >
              <span
                className={clsx("block w-full rounded-t-[4px] bg-accent transition-opacity", active != null && active !== i ? "opacity-50" : "opacity-100", "group-focus-visible:outline group-focus-visible:outline-2 group-focus-visible:outline-fg")}
                style={{ height: d.reviews ? Math.max(2, (d.reviews / max) * (H - 8)) : 0 }}
              />
            </button>
          ))}
        </div>
        {hovered && (
          <div
            className="pointer-events-none absolute -top-2 z-10 -translate-x-1/2 -translate-y-full rounded-md border border-border bg-bg px-2.5 py-1.5 text-xs shadow-lg"
            style={{ left: `calc(1.5rem + (100% - 1.5rem) * ${(active! + 0.5) / daily.length})` }}
          >
            <div className="font-semibold">{hovered.reviews} review{hovered.reviews === 1 ? "" : "s"}</div>
            <div className="text-muted">{hovered.posted} posted · {shortDay(hovered.day)}</div>
          </div>
        )}
      </div>
      <div className="mt-1 flex justify-between pl-6 text-[11px] text-muted">
        <span>{shortDay(daily[0].day)}</span>
        <span>{shortDay(daily[daily.length - 1].day)}</span>
      </div>
      <details className="mt-2 text-xs text-muted">
        <summary className="cursor-pointer">Show as table</summary>
        <table className="mt-1 w-full tabular-nums">
          <thead><tr><th className="text-left font-medium">Day</th><th className="text-right font-medium">Reviews</th><th className="text-right font-medium">Posted</th></tr></thead>
          <tbody>
            {daily.filter((d) => d.reviews || d.posted).map((d) => (
              <tr key={d.day}><td>{shortDay(d.day)}</td><td className="text-right">{d.reviews}</td><td className="text-right">{d.posted}</td></tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}

function SeverityBars({ severity, total }: { severity: Record<string, number>; total: number }) {
  const max = Math.max(1, ...SEVERITY.map((s) => severity[s.key] ?? 0));
  return (
    <ul className="space-y-3 p-4 text-sm">
      {SEVERITY.map((s) => {
        const n = severity[s.key] ?? 0;
        return (
          <li key={s.key}>
            <div className="mb-1 flex justify-between">
              <span>{s.label}</span>
              <span className="tabular-nums text-muted">{n.toLocaleString()}{total ? ` · ${Math.round((n / total) * 100)}%` : ""}</span>
            </div>
            <div className="h-2 rounded-full bg-panel-2">
              <div className={clsx("h-2 rounded-full", s.bar)} style={{ width: `${(n / max) * 100}%` }} />
            </div>
          </li>
        );
      })}
      <li className="pt-1 text-xs text-muted">{total.toLocaleString()} AI findings (carried-over findings counted once)</li>
    </ul>
  );
}

function StatsTable({ rows, first }: { rows: (Stats & { key: string; label: string })[]; first: string }) {
  if (!rows.length) return <p className="p-4 text-sm text-muted">No data.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="border-b border-border text-xs text-muted">
          <tr>
            <th className="px-4 py-2 text-left font-medium">{first}</th>
            <th className="px-2 py-2 text-right font-medium">Reviews</th>
            <th className="px-2 py-2 text-right font-medium">Posted</th>
            <th className="px-2 py-2 text-right font-medium">Findings</th>
            <th className="px-2 py-2 text-right font-medium">Critical</th>
            <th className="px-2 py-2 text-right font-medium">Accepted</th>
            <th className="px-4 py-2 text-right font-medium">Spend</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border tabular-nums">
          {rows.map((r) => (
            <tr key={r.key}>
              <td className="max-w-56 truncate px-4 py-2" title={r.label}>{r.label}</td>
              <td className="px-2 text-right">{r.reviews}</td>
              <td className="px-2 text-right">{r.posted}</td>
              <td className="px-2 text-right">{r.findings}</td>
              <td className={clsx("px-2 text-right", r.critical && "text-danger")}>{r.critical}</td>
              <td className="px-2 text-right">{pct(r.acceptanceRate)}</td>
              <td className="px-4 text-right">{money(r.costUsd)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
