import picomatch from "picomatch";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

// Repository review rules, read from the PR's target branch so a PR can't rewrite its own review rules.

export const RULES_FILES = [".pr-review.yml", ".pr-review.yaml", ".github/pr-review.yml"];

const SEVERITIES = ["critical", "major", "minor", "nit"] as const;
export type MinSeverity = (typeof SEVERITIES)[number];

const MAX_INSTRUCTIONS = 5000;
const MAX_IGNORE = 100;
const MAX_PATH_RULES = 50;

export interface RepoRules {
  instructions: string | null;
  ignore: string[];
  minSeverity: MinSeverity | null;
  fullFileContext: boolean | null;
  pathInstructions: { path: string; instructions: string }[];
}

const stringList = z.union([z.string(), z.array(z.string())]).transform((v) => (Array.isArray(v) ? v : [v]));

const schema = z.object({
  instructions: z.string().nullish(),
  ignore: stringList.nullish(),
  min_severity: z
    .preprocess((v) => (typeof v === "string" ? v.toLowerCase().trim() : v), z.enum(SEVERITIES))
    .nullish(),
  full_file_context: z.boolean().nullish(),
  path_instructions: z
    .array(z.object({ path: stringList, instructions: z.string().min(1) }))
    .nullish(),
});

const KNOWN_KEYS = new Set(Object.keys(schema.shape));

export function parseRepoRules(text: string): { rules: RepoRules | null; warnings: string[] } {
  const warnings: string[] = [];
  let data: unknown;
  try {
    data = parseYaml(text, { maxAliasCount: 50 });
  } catch (err) {
    return { rules: null, warnings: [`Invalid YAML: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`] };
  }
  if (data == null) return { rules: null, warnings: ["The file is empty."] };
  if (typeof data !== "object" || Array.isArray(data)) return { rules: null, warnings: ["The file must be a YAML mapping (key: value)."] };

  for (const key of Object.keys(data)) if (!KNOWN_KEYS.has(key)) warnings.push(`Unknown key "${key}" ignored.`);

  // Validate each key on its own so one bad value doesn't discard the rest.
  const obj = data as Record<string, unknown>;
  const pick = <K extends keyof typeof schema.shape>(key: K) => {
    const r = schema.shape[key].safeParse(obj[key]);
    if (r.success) return r.data as z.infer<(typeof schema.shape)[K]>;
    warnings.push(`"${key}" ignored: ${r.error.issues[0]?.message ?? "invalid value"}.`);
    return null;
  };

  let instructions = pick("instructions")?.trim() || null;
  if (instructions && instructions.length > MAX_INSTRUCTIONS) {
    instructions = instructions.slice(0, MAX_INSTRUCTIONS);
    warnings.push(`"instructions" truncated to ${MAX_INSTRUCTIONS} characters.`);
  }
  let ignore = (pick("ignore") ?? []).map((s) => s.trim()).filter(Boolean);
  if (ignore.length > MAX_IGNORE) {
    ignore = ignore.slice(0, MAX_IGNORE);
    warnings.push(`Only the first ${MAX_IGNORE} "ignore" patterns are used.`);
  }
  let pathInstructions = (pick("path_instructions") ?? []).flatMap((r) =>
    r.path.map((p) => ({ path: p.trim(), instructions: r.instructions.trim().slice(0, MAX_INSTRUCTIONS) })),
  );
  if (pathInstructions.length > MAX_PATH_RULES) {
    pathInstructions = pathInstructions.slice(0, MAX_PATH_RULES);
    warnings.push(`Only the first ${MAX_PATH_RULES} "path_instructions" entries are used.`);
  }

  return {
    rules: {
      instructions,
      ignore,
      minSeverity: pick("min_severity") ?? null,
      fullFileContext: pick("full_file_context") ?? null,
      pathInstructions,
    },
    warnings,
  };
}

/** Path-scoped instructions that apply to any of `paths`, formatted for the prompt. */
export function instructionsForPaths(rules: Pick<RepoRules, "pathInstructions">, paths: string[]): string | null {
  const parts: string[] = [];
  for (const r of rules.pathInstructions) {
    const match = picomatch(r.path, { dot: true });
    const hits = paths.filter((p) => match(p));
    if (hits.length) parts.push(`For ${r.path} (${hits.slice(0, 5).join(", ")}${hits.length > 5 ? ", …" : ""}):\n${r.instructions}`);
  }
  return parts.length ? parts.join("\n\n") : null;
}

const RANK: Record<MinSeverity, number> = { critical: 0, major: 1, minor: 2, nit: 3 };

/** The stricter of two thresholds (the one that drops more findings). */
export function stricterSeverity(a: MinSeverity | null | undefined, b: MinSeverity | null | undefined): MinSeverity | null {
  if (!a) return b ?? null;
  if (!b) return a;
  return RANK[a] <= RANK[b] ? a : b;
}

export function meetsSeverity(severity: MinSeverity, min: MinSeverity | null | undefined) {
  return !min || RANK[severity] <= RANK[min];
}
