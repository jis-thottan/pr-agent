"use client";

import { Fragment, memo, useMemo, type ReactNode } from "react";
import clsx from "clsx";
import { parsePatch, commentableLines, type DiffLine, type Hunk } from "@/lib/diff";
import { highlightLine, langFor } from "@/lib/highlight";
import type { DraftComment, Finding, PrFile } from "./types";

export type ViewMode = "unified" | "split" | "full";

type Props = {
  file: PrFile;
  mode: ViewMode;
  findings: Finding[];
  draft: DraftComment | null;
  fullContent: string | null;
  onLineClick: (line: number, shift: boolean) => void;
  renderFinding: (f: Finding) => ReactNode;
  renderDraft: () => ReactNode;
};

type SplitRow = { left?: DiffLine; right?: DiffLine };

function toSplitRows(h: Hunk): SplitRow[] {
  const rows: SplitRow[] = [];
  const ls = h.lines;
  let i = 0;
  while (i < ls.length) {
    const l = ls[i];
    if (l.type === "ctx") {
      rows.push({ left: l, right: l });
      i++;
      continue;
    }
    const dels: DiffLine[] = [];
    const adds: DiffLine[] = [];
    while (i < ls.length && ls[i].type === "del") dels.push(ls[i++]);
    while (i < ls.length && ls[i].type === "add") adds.push(ls[i++]);
    for (let k = 0; k < Math.max(dels.length, adds.length); k++) rows.push({ left: dels[k], right: adds[k] });
  }
  return rows;
}

const numCell = "w-[1%] min-w-[3.25rem] select-none border-r border-border px-2 text-right align-top text-muted tabular-nums";

export const DiffView = memo(function DiffView({ file, mode, findings, draft, fullContent, onLineClick, renderFinding, renderDraft }: Props) {
  const hunks = useMemo(() => parsePatch(file.patch), [file.patch]);
  const commentable = useMemo(() => commentableLines(hunks), [hunks]);
  const lang = useMemo(() => langFor(file.path), [file.path]);

  // Findings are shown under the last line of their range, like GitHub.
  const byLine = useMemo(() => {
    const m = new Map<number, Finding[]>();
    for (const f of findings) {
      if (!f.line || (!f.inDiff && mode !== "full")) continue;
      const anchor = f.endLine ?? f.line;
      m.set(anchor, [...(m.get(anchor) ?? []), f]);
    }
    return m;
  }, [findings, mode]);

  const draftAnchor = draft && draft.path === file.path ? (draft.endLine ?? draft.line) : null;
  const inDraftRange = (n: number | null) =>
    n !== null && draft && draft.path === file.path && n >= draft.line && n <= (draft.endLine ?? draft.line);

  const widgets = (newLine: number | null, colSpan: number) => {
    if (newLine === null) return null;
    const fs = byLine.get(newLine);
    const showDraft = draftAnchor === newLine;
    if (!fs?.length && !showDraft) return null;
    return (
      <tr>
        <td colSpan={colSpan} className="border-y border-border bg-panel px-3 py-2">
          <div className="max-w-4xl space-y-2">
            {fs?.map((f) => <Fragment key={f.id}>{renderFinding(f)}</Fragment>)}
            {showDraft && renderDraft()}
          </div>
        </td>
      </tr>
    );
  };

  const addButton = (n: number | null) =>
    n !== null && commentable.has(n) ? (
      <button
        className="absolute -left-2.5 top-0 hidden h-5 w-5 items-center justify-center rounded bg-accent text-xs font-bold leading-none text-accent-fg group-hover:flex"
        title="Comment on this line (Shift+click another line to select a range)"
        onClick={(e) => onLineClick(n, e.shiftKey)}
      >
        +
      </button>
    ) : null;

  const code = (content: string) => <span dangerouslySetInnerHTML={{ __html: highlightLine(content, lang) || "&nbsp;" }} />;

  if (!file.patch) {
    return (
      <div className="px-4 py-8 text-center text-sm text-muted">
        {file.status === "removed" ? "This file was deleted." : "No text diff is available. The file is binary, renamed without changes, or too large to diff."}
      </div>
    );
  }

  if (mode === "full") {
    if (fullContent === null) return <div className="px-4 py-8 text-center text-sm text-muted">Loading file…</div>;
    const added = new Set(hunks.flatMap((h) => h.lines.filter((l) => l.type === "add").map((l) => l.newLine!)));
    const lines = fullContent.split("\n");
    return (
      <table className="w-full table-fixed border-collapse font-mono text-[12.5px] leading-5">
        <colgroup><col className="w-14" /><col /></colgroup>
        <tbody>
          {lines.map((content, i) => {
            const n = i + 1;
            return (
              <Fragment key={n}>
                <tr className={clsx(added.has(n) && "bg-add", inDraftRange(n) && "!bg-[var(--focus)]")}>
                  <td className={clsx(numCell, added.has(n) && "bg-add-num")}>{n}</td>
                  <td className="group relative whitespace-pre-wrap break-words px-3">{addButton(n)}{code(content)}</td>
                </tr>
                {widgets(n, 2)}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    );
  }

  if (mode === "split") {
    return (
      <table className="w-full table-fixed border-collapse font-mono text-[12.5px] leading-5">
        <colgroup><col className="w-14" /><col /><col className="w-14" /><col /></colgroup>
        <tbody>
          {hunks.map((h, hi) => (
            <Fragment key={hi}>
              <tr className="bg-hunk text-muted"><td colSpan={4} className="px-3 py-1">{h.header}</td></tr>
              {toSplitRows(h).map((r, ri) => {
                const right = r.right?.newLine ?? null;
                return (
                  <Fragment key={ri}>
                    <tr>
                      <td className={clsx(numCell, r.left?.type === "del" && "bg-del-num")}>{r.left?.oldLine}</td>
                      <td className={clsx("whitespace-pre-wrap break-words border-r border-border px-3", r.left?.type === "del" ? "bg-del" : !r.left && "bg-panel")}>
                        {r.left && <><span className="select-none text-muted">{r.left.type === "del" ? "-" : " "}</span>{code(r.left.content)}</>}
                      </td>
                      <td className={clsx(numCell, r.right?.type === "add" && "bg-add-num", inDraftRange(right) && "!bg-[var(--focus)]")}>{right}</td>
                      <td className={clsx("group relative whitespace-pre-wrap break-words px-3", r.right?.type === "add" ? "bg-add" : !r.right && "bg-panel", inDraftRange(right) && "!bg-[var(--focus)]")}>
                        {addButton(right)}
                        {r.right && <><span className="select-none text-muted">{r.right.type === "add" ? "+" : " "}</span>{code(r.right.content)}</>}
                      </td>
                    </tr>
                    {widgets(right, 4)}
                  </Fragment>
                );
              })}
            </Fragment>
          ))}
        </tbody>
      </table>
    );
  }

  return (
    <table className="w-full table-fixed border-collapse font-mono text-[12.5px] leading-5">
      <colgroup><col className="w-14" /><col className="w-14" /><col /></colgroup>
      <tbody>
        {hunks.map((h, hi) => (
          <Fragment key={hi}>
            <tr className="bg-hunk text-muted"><td colSpan={3} className="px-3 py-1">{h.header}</td></tr>
            {h.lines.map((l, li) => {
              const bg = l.type === "add" ? "bg-add" : l.type === "del" ? "bg-del" : "";
              const numBg = l.type === "add" ? "bg-add-num" : l.type === "del" ? "bg-del-num" : "";
              const sel = inDraftRange(l.newLine) && "!bg-[var(--focus)]";
              return (
                <Fragment key={li}>
                  <tr className={clsx(bg, sel)}>
                    <td className={clsx(numCell, numBg)}>{l.oldLine}</td>
                    <td className={clsx(numCell, numBg)}>{l.newLine}</td>
                    <td className="group relative whitespace-pre-wrap break-words px-3">
                      {addButton(l.newLine)}
                      <span className="select-none text-muted">{l.type === "add" ? "+" : l.type === "del" ? "-" : " "}</span>
                      {code(l.content)}
                    </td>
                  </tr>
                  {l.type !== "del" && widgets(l.newLine, 3)}
                </Fragment>
              );
            })}
          </Fragment>
        ))}
      </tbody>
    </table>
  );
});

/** Current code for a new-file line range, used to prefill a suggestion. */
export function linesFromPatch(patch: string | null, from: number, to: number): string {
  const out: string[] = [];
  for (const h of parsePatch(patch)) for (const l of h.lines) if (l.newLine !== null && l.newLine >= from && l.newLine <= to) out.push(l.content);
  return out.join("\n");
}
