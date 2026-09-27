// Incremental review: only files whose blob changed since an earlier review are sent to the model;
// findings on the other files are copied forward from that review.

export interface FileWithSha {
  path: string;
  sha: string | null;
}

/** Splits the PR's current files into those changed since `previous` (path → blob SHA) and those not. */
export function splitBySha<T extends FileWithSha>(files: T[], previous: Record<string, string>) {
  const changed: T[] = [];
  const unchanged: T[] = [];
  for (const f of files) {
    if (f.sha && previous[f.path] === f.sha) unchanged.push(f);
    else changed.push(f);
  }
  return { changed, unchanged };
}

export function shaMap(files: FileWithSha[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of files) if (f.sha) out[f.path] = f.sha;
  return out;
}

export interface CarryableFinding {
  id: string;
  path: string;
  line: number | null;
  endLine: number | null;
  inDiff: boolean;
}

/**
 * Findings from the earlier review that belong to unchanged files. Line numbers still hold (the file
 * didn't change), but whether a line is inside the diff can change if the target branch moved.
 */
export function carryForward<T extends CarryableFinding>(
  previous: T[],
  unchangedPaths: Set<string>,
  commentable: Map<string, Set<number>>,
): (T & { carriedFromId: string })[] {
  return previous
    .filter((f) => unchangedPaths.has(f.path))
    .map((f) => {
      const lines = commentable.get(f.path);
      const inDiff = Boolean(f.line && lines?.has(f.line) && (!f.endLine || lines.has(f.endLine)));
      return { ...f, inDiff, endLine: inDiff ? f.endLine : null, carriedFromId: f.id };
    });
}
