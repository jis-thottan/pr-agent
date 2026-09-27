import "server-only";
import type { ScmProvider } from "../scm/types";
import { parseRepoRules, RULES_FILES, type RepoRules } from "./rules";

export interface LoadedRepoRules {
  path: string;
  ref: string;
  rules: RepoRules | null;
  warnings: string[];
}

/** Finds and parses the first rules file at `ref` (the PR's base commit). Null when the repo has none. */
export async function loadRepoRules(scm: ScmProvider, owner: string, repo: string, ref: string): Promise<LoadedRepoRules | null> {
  for (const path of RULES_FILES) {
    let text: string | null;
    try {
      text = await scm.getFileContent(owner, repo, path, ref);
    } catch (err) {
      return { path, ref, rules: null, warnings: [`Could not read ${path}: ${err instanceof Error ? err.message : String(err)}`] };
    }
    if (text !== null) return { path, ref, ...parseRepoRules(text) };
  }
  return null;
}
