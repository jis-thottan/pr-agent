// Pure aggregation for the team dashboard, so the math is unit-testable.

export interface ReviewRow {
  id: string;
  userId: string;
  owner: string;
  repo: string;
  trigger: "manual" | "webhook";
  status: string;
  baseReviewId: string | null;
  costUsd: number;
  createdAt: Date;
  completedAt: Date | null;
  postedAt: Date | null;
}

export interface FindingAgg {
  reviewId: string;
  severity: string;
  category: string;
  state: string;
  n: number;
}

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const dayKey = (d: Date) => d.toISOString().slice(0, 10);

export function aggregate(reviews: ReviewRow[], findings: FindingAgg[], users: Map<string, string>, since: Date, until: Date) {
  const byReview = new Map<string, FindingAgg[]>();
  for (const f of findings) {
    const list = byReview.get(f.reviewId) ?? [];
    list.push(f);
    byReview.set(f.reviewId, list);
  }
  const sum = (fs: FindingAgg[], pred: (f: FindingAgg) => boolean) => fs.filter(pred).reduce((n, f) => n + f.n, 0);
  const accepted = (f: FindingAgg) => f.state === "accepted" || f.state === "posted";
  const decided = (f: FindingAgg) => accepted(f) || f.state === "dismissed";

  const severity: Record<string, number> = {};
  const category: Record<string, number> = {};
  for (const f of findings) {
    severity[f.severity] = (severity[f.severity] ?? 0) + f.n;
    category[f.category] = (category[f.category] ?? 0) + f.n;
  }

  // One bucket per UTC day in the window, so quiet days show as zero.
  const daily = new Map<string, { day: string; reviews: number; posted: number }>();
  for (let t = Date.UTC(since.getUTCFullYear(), since.getUTCMonth(), since.getUTCDate()); t <= until.getTime(); t += 86_400_000) {
    const k = dayKey(new Date(t));
    daily.set(k, { day: k, reviews: 0, posted: 0 });
  }
  for (const r of reviews) {
    const d = daily.get(dayKey(r.createdAt));
    if (d) d.reviews++;
    const p = r.postedAt && daily.get(dayKey(r.postedAt));
    if (p) p.posted++;
  }

  const turnaround = reviews
    .filter((r) => r.completedAt && r.postedAt && r.postedAt >= r.completedAt)
    .map((r) => (r.postedAt!.getTime() - r.completedAt!.getTime()) / 60_000);

  const group = <K extends string>(key: (r: ReviewRow) => K) => {
    const m = new Map<K, ReviewRow[]>();
    for (const r of reviews) m.set(key(r), [...(m.get(key(r)) ?? []), r]);
    return m;
  };
  const statsFor = (rs: ReviewRow[]) => {
    const fs = rs.flatMap((r) => byReview.get(r.id) ?? []);
    const dec = sum(fs, decided);
    return {
      reviews: rs.length,
      posted: rs.filter((r) => r.postedAt).length,
      findings: sum(fs, () => true),
      critical: sum(fs, (f) => f.severity === "critical"),
      acceptanceRate: dec ? sum(fs, accepted) / dec : null,
      costUsd: rs.reduce((n, r) => n + r.costUsd, 0),
    };
  };

  const allFindings = findings;
  const decidedAll = sum(allFindings, decided);
  return {
    totals: {
      reviews: reviews.length,
      automatic: reviews.filter((r) => r.trigger === "webhook").length,
      incremental: reviews.filter((r) => r.baseReviewId).length,
      completed: reviews.filter((r) => r.status === "completed").length,
      failed: reviews.filter((r) => r.status === "failed").length,
      posted: reviews.filter((r) => r.postedAt).length,
      findings: sum(allFindings, () => true),
      pendingFindings: sum(allFindings, (f) => f.state === "pending"),
      acceptanceRate: decidedAll ? sum(allFindings, accepted) / decidedAll : null,
      medianMinutesToPost: median(turnaround),
      costUsd: reviews.reduce((n, r) => n + r.costUsd, 0),
    },
    severity,
    category,
    daily: [...daily.values()],
    repos: [...group((r) => `${r.owner}/${r.repo}`)]
      .map(([repo, rs]) => ({ repo, ...statsFor(rs) }))
      .sort((a, b) => b.reviews - a.reviews)
      .slice(0, 10),
    reviewers: [...group((r) => r.userId)]
      .map(([userId, rs]) => ({ userId, name: users.get(userId) ?? "Deleted user", ...statsFor(rs) }))
      .sort((a, b) => b.reviews - a.reviews),
  };
}
