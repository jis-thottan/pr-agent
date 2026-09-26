"use client";

import { useMemo, useState } from "react";
import clsx from "clsx";
import { Input } from "../ui";
import { SEVERITY_RANK, type Finding, type PrFile, type Severity } from "./types";

const STATUS: Record<string, { letter: string; cls: string }> = {
  added: { letter: "A", cls: "text-ok" },
  removed: { letter: "D", cls: "text-danger" },
  renamed: { letter: "R", cls: "text-accent" },
  copied: { letter: "C", cls: "text-accent" },
  modified: { letter: "M", cls: "text-warn" },
  changed: { letter: "M", cls: "text-warn" },
};

const SEV_DOT: Record<Severity, string> = { critical: "bg-danger", major: "bg-warn", minor: "bg-accent", nit: "bg-muted" };

export function FileTree({
  files,
  selected,
  onSelect,
  findingsByPath,
  isViewed,
  onToggleViewed,
  skipped,
}: {
  files: PrFile[];
  selected: string | null;
  onSelect: (path: string) => void;
  findingsByPath: Map<string, Finding[]>;
  isViewed: (f: PrFile) => boolean;
  onToggleViewed: (f: PrFile) => void;
  skipped: Set<string>;
}) {
  const [q, setQ] = useState("");
  const [onlyFindings, setOnlyFindings] = useState(false);
  const [hideViewed, setHideViewed] = useState(false);

  const visible = useMemo(() => {
    const n = q.toLowerCase();
    return files.filter(
      (f) =>
        (!n || f.path.toLowerCase().includes(n)) &&
        (!onlyFindings || (findingsByPath.get(f.path) ?? []).some((x) => x.state !== "dismissed")) &&
        (!hideViewed || !isViewed(f)),
    );
  }, [files, q, onlyFindings, hideViewed, findingsByPath, isViewed]);

  const viewedCount = files.filter(isViewed).length;
  let lastDir = "";

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-2 border-b border-border p-2">
        <Input placeholder="Filter files…" value={q} onChange={(e) => setQ(e.target.value)} className="h-7 text-xs" />
        <div className="flex items-center gap-3 text-xs text-muted">
          <label className="flex items-center gap-1"><input type="checkbox" checked={onlyFindings} onChange={(e) => setOnlyFindings(e.target.checked)} /> With findings</label>
          <label className="flex items-center gap-1"><input type="checkbox" checked={hideViewed} onChange={(e) => setHideViewed(e.target.checked)} /> Hide viewed</label>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-panel-2">
            <div className="h-full bg-ok transition-all" style={{ width: `${files.length ? (viewedCount / files.length) * 100 : 0}%` }} />
          </div>
          {viewedCount}/{files.length} viewed
        </div>
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto py-1 text-[13px]">
        {visible.map((f) => {
          const dir = f.path.includes("/") ? f.path.slice(0, f.path.lastIndexOf("/")) : "";
          const name = f.path.slice(dir ? dir.length + 1 : 0);
          const showDir = dir !== lastDir;
          lastDir = dir;
          const fs = (findingsByPath.get(f.path) ?? []).filter((x) => x.state !== "dismissed");
          const worst = fs.reduce<Severity | null>((w, x) => (!w || SEVERITY_RANK[x.severity] < SEVERITY_RANK[w] ? x.severity : w), null);
          const st = STATUS[f.status] ?? STATUS.modified;
          const viewed = isViewed(f);
          return (
            <li key={f.path}>
              {showDir && dir && <div className="truncate px-3 pb-0.5 pt-2 font-mono text-[11px] text-muted" title={dir}>{dir}/</div>}
              <div
                className={clsx(
                  "group flex cursor-pointer items-center gap-1.5 py-1 pl-4 pr-2",
                  selected === f.path ? "bg-accent/15 text-fg" : "hover:bg-panel-2",
                  viewed && selected !== f.path && "text-muted",
                )}
                onClick={() => onSelect(f.path)}
                title={f.path}
              >
                <span className={clsx("w-3 shrink-0 font-mono text-[11px] font-bold", st.cls)}>{st.letter}</span>
                <span className={clsx("min-w-0 flex-1 truncate", skipped.has(f.path) && "italic opacity-70")}>{name}</span>
                {fs.length > 0 && (
                  <span className="flex items-center gap-1 text-[11px] text-muted">
                    <span className={clsx("h-2 w-2 rounded-full", SEV_DOT[worst!])} />
                    {fs.length}
                  </span>
                )}
                <span className="font-mono text-[10px] text-ok">+{f.additions}</span>
                <span className="font-mono text-[10px] text-danger">-{f.deletions}</span>
                <input
                  type="checkbox"
                  checked={viewed}
                  onClick={(e) => e.stopPropagation()}
                  onChange={() => onToggleViewed(f)}
                  title="Mark as viewed (v)"
                  className="ml-0.5"
                />
              </div>
            </li>
          );
        })}
        {!visible.length && <li className="px-3 py-4 text-center text-xs text-muted">No files match.</li>}
      </ul>
    </div>
  );
}
