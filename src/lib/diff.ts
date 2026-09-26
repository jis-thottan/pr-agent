// Unified-diff hunk parsing shared by the review engine (server) and the diff viewer (client).

export type DiffLineType = "add" | "del" | "ctx";

export interface DiffLine {
  type: DiffLineType;
  oldLine: number | null;
  newLine: number | null;
  content: string;
}

export interface Hunk {
  header: string;
  oldStart: number;
  newStart: number;
  lines: DiffLine[];
}

const HUNK_RE = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/;

/** Parses the hunk section of a unified diff (the `patch` field GitHub returns per file). */
export function parsePatch(patch: string | null | undefined): Hunk[] {
  if (!patch) return [];
  const hunks: Hunk[] = [];
  let cur: Hunk | null = null;
  let oldNo = 0;
  let newNo = 0;
  for (const raw of patch.split("\n")) {
    const m = HUNK_RE.exec(raw);
    if (m) {
      oldNo = Number(m[1]);
      newNo = Number(m[2]);
      cur = { header: raw, oldStart: oldNo, newStart: newNo, lines: [] };
      hunks.push(cur);
      continue;
    }
    if (!cur || raw.startsWith("\\")) continue; // "\ No newline at end of file"
    const tag = raw[0];
    const content = raw.slice(1);
    if (tag === "+") cur.lines.push({ type: "add", oldLine: null, newLine: newNo++, content });
    else if (tag === "-") cur.lines.push({ type: "del", oldLine: oldNo++, newLine: null, content });
    else if (tag === " " || raw === "")
      cur.lines.push({ type: "ctx", oldLine: oldNo++, newLine: newNo++, content });
  }
  // A trailing newline in the patch produces a phantom empty context line; drop it.
  const last = hunks.at(-1)?.lines.at(-1);
  if (last && last.type === "ctx" && last.content === "" && patch.endsWith("\n")) hunks.at(-1)!.lines.pop();
  return hunks;
}

/** New-file line numbers that can carry an inline review comment (added or context lines). */
export function commentableLines(hunks: Hunk[]): Set<number> {
  const s = new Set<number>();
  for (const h of hunks) for (const l of h.lines) if (l.newLine !== null) s.add(l.newLine);
  return s;
}

/** Nearest commentable line within `maxDistance`, or null. */
export function snapToCommentable(line: number, lines: Set<number>, maxDistance = 3): number | null {
  if (lines.has(line)) return line;
  for (let d = 1; d <= maxDistance; d++) {
    if (lines.has(line - d)) return line - d;
    if (lines.has(line + d)) return line + d;
  }
  return null;
}

/**
 * Renders hunks with explicit new-file line numbers so the model can cite exact lines:
 *   "  42 + added line" / "  43   context" / "     - removed line"
 */
export function formatPatchForPrompt(hunks: Hunk[]): string {
  const out: string[] = [];
  for (const h of hunks) {
    out.push(h.header);
    for (const l of h.lines) {
      const no = l.newLine === null ? "" : String(l.newLine);
      const mark = l.type === "add" ? "+" : l.type === "del" ? "-" : " ";
      out.push(`${no.padStart(5)} ${mark} ${l.content}`);
    }
  }
  return out.join("\n");
}
