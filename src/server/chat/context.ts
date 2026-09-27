import { formatPatchForPrompt, parsePatch } from "../../lib/diff.ts";

export const CHAT_SYSTEM_PROMPT = `You are a senior engineer helping a tech lead understand and review a pull request.
Answer questions about the change using the pull request context below: the description, the changed files and their diffs, and any review findings.

Rules:
- Ground every claim in the provided context. Cite code as \`path:line\` using the new-file line numbers shown in the diffs.
- If the answer depends on code that is not in the context (an omitted file, or code outside the diff), say so plainly instead of guessing.
- Be direct and concise. Use GitHub-flavoured markdown; use code blocks for code.
- When asked for a fix, show only the changed lines with enough surrounding context to place them.`;

export interface ChatFile {
  path: string;
  status: string;
  additions: number;
  deletions: number;
  patch: string | null;
}

export interface ChatFinding {
  path: string;
  line: number | null;
  severity: string;
  title: string;
  state: string;
}

/** Files named in the question, by full path or by file name. */
export function mentionedPaths(question: string, paths: string[]) {
  const q = question.toLowerCase();
  return paths.filter((p) => {
    const lower = p.toLowerCase();
    const base = lower.split("/").pop()!;
    return q.includes(lower) || (base.length > 3 && new RegExp(`(^|[^\\w.-])${base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^\\w-])`).test(q));
  });
}

/**
 * Builds the PR context for one chat turn within `budget` characters. Priority: the file the
 * reviewer is looking at, then files named in the question, then the rest (smallest diffs first).
 */
export function buildChatContext(opts: {
  title: string;
  description: string;
  files: ChatFile[];
  findings: ChatFinding[];
  question: string;
  focusPath?: string | null;
  focusContent?: string | null;
  budget: number;
}) {
  const parts: string[] = [];
  let used = 0;
  const push = (s: string) => {
    parts.push(s);
    used += s.length + 2;
  };

  push(`Title: ${opts.title}`);
  if (opts.description) push(`Description:\n${opts.description.slice(0, 3000)}`);
  push(
    `Changed files (${opts.files.length}):\n` +
      opts.files
        .slice(0, 300)
        .map((f) => `- ${f.path} (${f.status}, +${f.additions}/-${f.deletions})`)
        .join("\n"),
  );
  const open = opts.findings.filter((f) => f.state !== "dismissed").slice(0, 60);
  if (open.length) {
    push(`Review findings so far:\n${open.map((f) => `- [${f.severity}] ${f.path}${f.line ? `:${f.line}` : ""}: ${f.title} (${f.state})`).join("\n")}`);
  }

  const paths = opts.files.map((f) => f.path);
  const mentioned = new Set(mentionedPaths(opts.question, paths));
  const rank = (f: ChatFile) => (f.path === opts.focusPath ? 0 : mentioned.has(f.path) ? 1 : 2);
  const ordered = [...opts.files]
    .filter((f) => f.patch)
    .sort((a, b) => rank(a) - rank(b) || (a.patch!.length - b.patch!.length));

  if (opts.focusPath && opts.focusContent && opts.focusContent.length + used < opts.budget * 0.4) {
    const numbered = opts.focusContent
      .split("\n")
      .map((l, i) => `${String(i + 1).padStart(5)}   ${l}`)
      .join("\n");
    push(`Full content of ${opts.focusPath} (the file the reviewer has open):\n${numbered}`);
  }

  const included: string[] = [];
  const omitted: string[] = [];
  for (const f of ordered) {
    const text = `### File: ${f.path} (${f.status})\n${formatPatchForPrompt(parsePatch(f.patch))}`;
    if (used + text.length + 2 <= opts.budget) {
      push(text);
      included.push(f.path);
    } else {
      omitted.push(f.path);
    }
  }
  if (omitted.length) {
    push(`Diffs not included because of the context limit: ${omitted.slice(0, 100).join(", ")}${omitted.length > 100 ? ", …" : ""}. Ask about a specific file to bring it into view.`);
  }
  return { text: parts.join("\n\n"), included, omitted };
}
