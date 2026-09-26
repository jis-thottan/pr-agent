"use client";

import { useMemo, useState } from "react";
import clsx from "clsx";
import { Badge, Empty } from "../ui";
import { SEVERITIES, SEVERITY_TONE, type Finding, type Severity } from "./types";

export function FindingsList({ findings, onOpen }: { findings: Finding[]; onOpen: (f: Finding) => void }) {
  const [sev, setSev] = useState<Set<Severity>>(new Set(SEVERITIES));
  const [state, setState] = useState<"open" | "all" | "accepted" | "dismissed">("open");
  const list = useMemo(
    () =>
      findings.filter(
        (f) =>
          sev.has(f.severity) &&
          (state === "all" ||
            (state === "open" && (f.state === "pending" || f.state === "accepted")) ||
            (state === "accepted" && (f.state === "accepted" || f.state === "posted")) ||
            (state === "dismissed" && f.state === "dismissed")),
      ),
    [findings, sev, state],
  );

  return (
    <div className="mx-auto max-w-5xl space-y-3 p-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {SEVERITIES.map((s) => (
          <button
            key={s}
            onClick={() => setSev((cur) => { const n = new Set(cur); if (n.has(s)) n.delete(s); else n.add(s); return n; })}
            className={clsx("rounded-full", !sev.has(s) && "opacity-40")}
          >
            <Badge tone={SEVERITY_TONE[s]}>{s} · {findings.filter((f) => f.severity === s).length}</Badge>
          </button>
        ))}
        <div className="ml-auto flex rounded-md border border-border text-xs">
          {(["open", "accepted", "dismissed", "all"] as const).map((s) => (
            <button key={s} onClick={() => setState(s)} className={clsx("px-2.5 py-1 capitalize", state === s ? "bg-panel-2 font-medium" : "text-muted")}>{s}</button>
          ))}
        </div>
      </div>
      {!list.length ? (
        <Empty title="No findings">Nothing matches the current filters.</Empty>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {list.map((f) => (
            <li key={f.id}>
              <button className="flex w-full items-start gap-3 px-4 py-2.5 text-left hover:bg-panel" onClick={() => onOpen(f)}>
                <Badge tone={f.source === "human" ? "accent" : SEVERITY_TONE[f.severity]} className="mt-0.5 w-16 justify-center">{f.source === "human" ? "you" : f.severity}</Badge>
                <div className="min-w-0 flex-1">
                  <div className={clsx("font-medium", f.state === "dismissed" && "line-through text-muted")}>{f.title}</div>
                  <div className="truncate font-mono text-xs text-muted">{f.path}{f.line ? `:${f.line}` : ""} · {f.category}</div>
                </div>
                <span className={clsx("text-xs", f.state === "accepted" ? "text-ok" : f.state === "posted" ? "text-accent" : "text-muted")}>{f.state}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
