import "server-only";
import type { Finding, Review } from "../db/schema";
import type { ReviewCommentInput } from "../scm/types";

const SEVERITY_BADGE: Record<string, string> = {
  critical: "🔴 Critical",
  major: "🟠 Major",
  minor: "🟡 Minor",
  nit: "⚪ Nit",
};

function cap(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function findingMarkdown(f: Finding, inline: boolean) {
  const head = f.source === "ai" ? `**${SEVERITY_BADGE[f.severity]} · ${cap(f.category)}** — ${f.title}` : f.title;
  const parts = [f.source === "ai" || f.title !== f.body ? head : "", f.body];
  if (f.suggestion) {
    parts.push(inline ? "```suggestion\n" + f.suggestion + "\n```" : "```\n" + f.suggestion + "\n```");
  }
  return parts.filter(Boolean).join("\n\n");
}

export function buildReviewPayload(opts: {
  review: Review;
  findings: Finding[];
  summary: string;
  reviewerName: string;
  attribution: boolean;
}) {
  const accepted = opts.findings.filter((f) => f.state === "accepted");
  const inline = accepted.filter((f) => f.inDiff && f.line);
  const general = accepted.filter((f) => !(f.inDiff && f.line));

  const comments: ReviewCommentInput[] = inline.map((f) => ({
    path: f.path,
    line: f.endLine ?? f.line!,
    startLine: f.endLine ? f.line! : undefined,
    body: findingMarkdown(f, true),
  }));

  const sections = [opts.summary.trim()];
  if (general.length) {
    sections.push(
      "### Additional findings\n\n" +
        general
          .map((f) => `- \`${f.path}${f.line ? `:${f.line}` : ""}\` ${findingMarkdown(f, false).replace(/\n/g, "\n  ")}`)
          .join("\n"),
    );
  }
  if (opts.attribution) {
    sections.push(`<sub>🤖 AI-assisted review (${opts.review.model}), verified by ${opts.reviewerName} via PR Review AI</sub>`);
  }
  return { body: sections.filter(Boolean).join("\n\n"), comments, posted: accepted.map((f) => f.id) };
}
