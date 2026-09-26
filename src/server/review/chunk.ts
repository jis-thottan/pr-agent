import { formatPatchForPrompt, parsePatch, type Hunk } from "../../lib/diff.ts";

export interface ReviewFileInput {
  path: string;
  previousPath: string | null;
  status: string;
  patch: string;
  /** Full new version of the file, when fetched for extra context. */
  content?: string | null;
}

export interface Batch {
  paths: string[];
  text: string;
}

const MAX_FILES_PER_BATCH = 8;

function header(f: ReviewFileInput, part?: string) {
  const rename = f.previousPath && f.previousPath !== f.path ? `, renamed from ${f.previousPath}` : "";
  return `### File: ${f.path} (${f.status}${rename})${part ? ` [part ${part}]` : ""}`;
}

function numbered(content: string) {
  return content
    .split("\n")
    .map((l, i) => `${String(i + 1).padStart(5)}   ${l}`)
    .join("\n");
}

/** Splits a hunk into pieces whose rendered text fits `budget` (large new files are one big hunk). */
function splitHunk(h: Hunk, budget: number): string[] {
  const text = formatPatchForPrompt([h]);
  if (text.length <= budget) return [text];
  const pieces: string[] = [];
  let lines: Hunk["lines"] = [];
  let size = 0;
  const flush = () => {
    if (!lines.length) return;
    const header = pieces.length ? `${h.header} (continued)` : h.header;
    pieces.push(formatPatchForPrompt([{ ...h, header, lines }]));
    lines = [];
    size = 0;
  };
  for (const l of h.lines) {
    // ~9 chars of line-number prefix per rendered line; very long lines are clipped.
    const content = l.content.length > budget / 2 ? l.content.slice(0, Math.floor(budget / 2)) + " …(clipped)" : l.content;
    const len = content.length + 10;
    if (size + len > budget - h.header.length - 20) flush();
    lines.push({ ...l, content });
    size += len;
  }
  flush();
  return pieces;
}

/** Renders one file into one or more prompt sections that each fit `budget` characters. */
export function renderFile(f: ReviewFileInput, budget: number): string[] {
  const hunks = parsePatch(f.patch);
  const diffText = formatPatchForPrompt(hunks);
  const withContext =
    f.content != null
      ? `${header(f)}\nFull file after the change (for context only):\n${numbered(f.content)}\n\nDiff (comment on these lines):\n${diffText}`
      : null;
  if (withContext && withContext.length <= budget * 0.7) return [withContext];

  const plain = `${header(f)}\n${diffText}`;
  if (plain.length <= budget) return [plain];

  // Too large: split by hunks into parts that fit.
  const parts: string[][] = [];
  let cur: string[] = [];
  let size = 0;
  const room = budget - header(f, "99/99").length - 1;
  for (const h of hunks) {
    for (const t of splitHunk(h, room)) {
      if (size + t.length + 1 > room && cur.length) {
        parts.push(cur);
        cur = [];
        size = 0;
      }
      cur.push(t);
      size += t.length + 1;
    }
  }
  if (cur.length) parts.push(cur);
  return parts.map((p, i) => `${header(f, `${i + 1}/${parts.length}`)}\n${p.join("\n")}`);
}

/** Greedily packs rendered file sections into batches that fit the model's context budget. */
export function buildBatches(files: ReviewFileInput[], budget: number): Batch[] {
  const batches: Batch[] = [];
  let cur: Batch = { paths: [], text: "" };
  const flush = () => {
    if (cur.paths.length) batches.push(cur);
    cur = { paths: [], text: "" };
  };
  for (const f of files) {
    for (const section of renderFile(f, budget)) {
      if (cur.paths.length && (cur.text.length + section.length + 2 > budget || cur.paths.length >= MAX_FILES_PER_BATCH)) {
        flush();
      }
      cur.text += (cur.text ? "\n\n" : "") + section;
      if (!cur.paths.includes(f.path)) cur.paths.push(f.path);
    }
  }
  flush();
  return batches;
}
