import picomatch from "picomatch";

/** Files that rarely benefit from AI review and burn tokens. Extend per review via `extraIgnore`. */
export const DEFAULT_IGNORE = [
  "**/package-lock.json",
  "**/yarn.lock",
  "**/pnpm-lock.yaml",
  "**/bun.lockb",
  "**/Cargo.lock",
  "**/poetry.lock",
  "**/Pipfile.lock",
  "**/composer.lock",
  "**/Gemfile.lock",
  "**/go.sum",
  "**/packages.lock.json",
  "**/*.min.js",
  "**/*.min.css",
  "**/*.map",
  "**/*.snap",
  "**/dist/**",
  "**/build/**",
  "**/vendor/**",
  "**/node_modules/**",
  "**/*.generated.*",
  "**/*.g.cs",
  "**/*.Designer.cs",
  "**/Migrations/*.Designer.cs",
  "**/*.pb.go",
  "**/*.svg",
  "**/*.png",
  "**/*.jpg",
  "**/*.jpeg",
  "**/*.gif",
  "**/*.ico",
  "**/*.pdf",
  "**/*.woff",
  "**/*.woff2",
];

export type SkipReason = "ignored" | "removed" | "no-diff";

export function createFileFilter(extraIgnore: string[] = []) {
  const isIgnored = picomatch([...DEFAULT_IGNORE, ...extraIgnore], { dot: true });
  return (file: { path: string; status: string; patch: string | null }): SkipReason | null => {
    if (file.status === "removed") return "removed";
    if (isIgnored(file.path)) return "ignored";
    if (!file.patch) return "no-diff";
    return null;
  };
}
