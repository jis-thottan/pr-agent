// Line diff (Myers O(ND)) that renders GitHub-style unified hunks, for code hosts that
// don't return patches themselves (Azure DevOps). Output is consumed by parsePatch in ./diff.ts.

type Op = { type: "eq" | "del" | "add"; a: number; b: number };

/** Beyond this many edits, fall back to "replace the changed middle" rather than burn memory. */
const MAX_EDIT_DISTANCE = 5000;

export function splitLines(text: string): string[] {
  if (text === "") return [];
  const lines = text.split(/\r?\n/);
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

/** Edit script between two line arrays. Common prefix/suffix are trimmed before running Myers. */
export function diffLines(a: string[], b: string[]): Op[] {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }

  const ops: Op[] = [];
  for (let i = 0; i < start; i++) ops.push({ type: "eq", a: i, b: i });
  const middle = myers(a, b, start, endA, start, endB) ?? replaceAll(start, endA, start, endB);
  ops.push(...middle);
  for (let i = 0; i < a.length - endA; i++) ops.push({ type: "eq", a: endA + i, b: endB + i });
  return ops;
}

function replaceAll(a0: number, a1: number, b0: number, b1: number): Op[] {
  const ops: Op[] = [];
  for (let i = a0; i < a1; i++) ops.push({ type: "del", a: i, b: b0 });
  for (let j = b0; j < b1; j++) ops.push({ type: "add", a: a1, b: j });
  return ops;
}

function myers(a: string[], b: string[], a0: number, a1: number, b0: number, b1: number): Op[] | null {
  const n = a1 - a0;
  const m = b1 - b0;
  if (n === 0 || m === 0) return replaceAll(a0, a1, b0, b1);

  // Intern lines so the inner loop compares integers.
  const ids = new Map<string, number>();
  const intern = (s: string) => {
    let id = ids.get(s);
    if (id === undefined) ids.set(s, (id = ids.size));
    return id;
  };
  const A = Int32Array.from({ length: n }, (_, i) => intern(a[a0 + i]));
  const B = Int32Array.from({ length: m }, (_, j) => intern(b[b0 + j]));

  const max = Math.min(n + m, MAX_EDIT_DISTANCE);
  const off = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];
  let found = -1;

  outer: for (let d = 0; d <= max; d++) {
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[off + k - 1] < v[off + k + 1]) ? v[off + k + 1] : v[off + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && A[x] === B[y]) {
        x++;
        y++;
      }
      v[off + k] = x;
      if (x >= n && y >= m) {
        trace.push(v.slice(off - d, off + d + 1));
        found = d;
        break outer;
      }
    }
    trace.push(v.slice(off - d, off + d + 1));
  }
  if (found < 0) return null;

  const rev: Op[] = [];
  let x = n;
  let y = m;
  for (let d = found; d > 0; d--) {
    const prev = trace[d - 1]; // indices -(d-1)..(d-1)
    const at = (k: number) => prev[k + d - 1];
    const k = x - y;
    const down = k === -d || (k !== d && at(k - 1) < at(k + 1));
    const prevK = down ? k + 1 : k - 1;
    const prevX = at(prevK);
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      x--;
      y--;
      rev.push({ type: "eq", a: a0 + x, b: b0 + y });
    }
    if (down) {
      y--;
      rev.push({ type: "add", a: a0 + x, b: b0 + y });
    } else {
      x--;
      rev.push({ type: "del", a: a0 + x, b: b0 + y });
    }
  }
  while (x > 0 && y > 0) {
    x--;
    y--;
    rev.push({ type: "eq", a: a0 + x, b: b0 + y });
  }
  return rev.reverse();
}

export interface UnifiedDiff {
  patch: string;
  additions: number;
  deletions: number;
}

/** Unified hunks (no file headers) between two texts, with `context` lines around each change. */
export function unifiedDiff(oldText: string, newText: string, context = 3): UnifiedDiff {
  const a = splitLines(oldText);
  const b = splitLines(newText);
  const ops = diffLines(a, b);
  let additions = 0;
  let deletions = 0;
  const changed: number[] = [];
  ops.forEach((op, i) => {
    if (op.type === "add") additions++;
    if (op.type === "del") deletions++;
    if (op.type !== "eq") changed.push(i);
  });
  if (!changed.length) return { patch: "", additions, deletions };

  // Group changes whose context windows touch into one hunk.
  const ranges: [number, number][] = [];
  for (const i of changed) {
    const lo = Math.max(0, i - context);
    const hi = Math.min(ops.length - 1, i + context);
    const last = ranges.at(-1);
    if (last && lo <= last[1] + 1) last[1] = Math.max(last[1], hi);
    else ranges.push([lo, hi]);
  }

  const out: string[] = [];
  for (const [lo, hi] of ranges) {
    const slice = ops.slice(lo, hi + 1);
    const oldLen = slice.filter((o) => o.type !== "add").length;
    const newLen = slice.filter((o) => o.type !== "del").length;
    const first = slice[0];
    // Unified-diff convention: an empty side starts at the line before (0 for a new file).
    const oldStart = oldLen ? first.a + 1 : first.a;
    const newStart = newLen ? first.b + 1 : first.b;
    out.push(`@@ -${oldStart},${oldLen} +${newStart},${newLen} @@`);
    for (const o of slice) {
      if (o.type === "eq") out.push(" " + a[o.a]);
      else if (o.type === "del") out.push("-" + a[o.a]);
      else out.push("+" + b[o.b]);
    }
  }
  return { patch: out.join("\n"), additions, deletions };
}
