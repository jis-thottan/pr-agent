import { z } from "zod";

const SEVERITIES = ["critical", "major", "minor", "nit"] as const;
const CATEGORIES = ["bug", "security", "performance", "maintainability", "style", "tests", "docs"] as const;

const SEVERITY_ALIASES: Record<string, (typeof SEVERITIES)[number]> = {
  blocker: "critical",
  high: "major",
  error: "major",
  medium: "minor",
  warning: "minor",
  low: "nit",
  info: "nit",
  suggestion: "nit",
};

const CATEGORY_ALIASES: Record<string, (typeof CATEGORIES)[number]> = {
  correctness: "bug",
  logic: "bug",
  "error-handling": "bug",
  perf: "performance",
  readability: "maintainability",
  design: "maintainability",
  testing: "tests",
  test: "tests",
  documentation: "docs",
  naming: "style",
  formatting: "style",
};

function enumish<T extends readonly string[]>(values: T, aliases: Record<string, T[number]>, fallback: T[number]) {
  return z.preprocess((v) => {
    const s = String(v ?? "").toLowerCase().trim();
    if ((values as readonly string[]).includes(s)) return s;
    return aliases[s] ?? fallback;
  }, z.enum(values as unknown as [T[number], ...T[number][]]));
}

const intish = z.preprocess((v) => {
  const n = typeof v === "string" ? parseInt(v, 10) : v;
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}, z.number().int().positive().nullable());

export const rawFindingSchema = z.object({
  file: z.string().min(1),
  line: intish.optional(),
  endLine: intish.optional(),
  severity: enumish(SEVERITIES, SEVERITY_ALIASES, "minor"),
  category: enumish(CATEGORIES, CATEGORY_ALIASES, "maintainability"),
  title: z.string().min(1).max(300),
  message: z.string().min(1),
  suggestion: z.string().nullish(),
});

export type RawFinding = z.infer<typeof rawFindingSchema>;

/** Pulls the first JSON object/array out of a model response (tolerates code fences and prose). */
export function extractJson(text: string): unknown {
  const cleaned = text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(cleaned);
  const candidates = [cleaned, fenced?.[1]];
  for (const c of candidates) {
    if (!c) continue;
    try {
      return JSON.parse(c);
    } catch {}
  }
  const start = cleaned.search(/[[{]/);
  if (start >= 0) {
    const open = cleaned[start];
    const close = open === "{" ? "}" : "]";
    const end = cleaned.lastIndexOf(close);
    if (end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1));
      } catch {}
    }
  }
  throw new Error("Model response did not contain valid JSON");
}

/** Validates each finding independently so one malformed item doesn't discard the rest. */
export function parseFindings(text: string): RawFinding[] {
  const data = extractJson(text);
  const list = Array.isArray(data) ? data : ((data as { findings?: unknown[] })?.findings ?? []);
  if (!Array.isArray(list)) return [];
  const out: RawFinding[] = [];
  for (const item of list) {
    if (item && typeof item === "object") {
      const o = item as Record<string, unknown>;
      // Accept a few common key spellings from weaker models.
      const normalized = {
        ...o,
        file: o.file ?? o.path ?? o.filename,
        line: o.line ?? o.startLine ?? o.start_line ?? o.lineNumber,
        endLine: o.endLine ?? o.end_line,
        message: o.message ?? o.body ?? o.description ?? o.comment,
        title: o.title ?? o.summary ?? String(o.message ?? o.body ?? "").split("\n")[0].slice(0, 120),
      };
      const parsed = rawFindingSchema.safeParse(normalized);
      if (parsed.success) out.push(parsed.data);
    }
  }
  return out;
}

export const summarySchema = z.object({
  summary: z.string().min(1),
  riskLevel: z.preprocess((v) => String(v ?? "").toLowerCase(), z.enum(["low", "medium", "high"])).catch("medium"),
  verdict: z
    .preprocess((v) => String(v ?? "").toLowerCase().replace(/[\s-]/g, "_"), z.enum(["approve", "comment", "request_changes"]))
    .catch("comment"),
});

export type SummaryResult = z.infer<typeof summarySchema>;

export function parseSummary(text: string): SummaryResult {
  try {
    return summarySchema.parse(extractJson(text));
  } catch {
    return { summary: text.trim() || "No summary produced.", riskLevel: "medium", verdict: "comment" };
  }
}
