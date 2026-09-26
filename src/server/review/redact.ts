// Best-effort masking of credentials before code leaves the network for a cloud AI provider.
// This is a safety net, not a guarantee; mark sensitive repos to use a local provider.

const PATTERNS: [RegExp, string][] = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "[REDACTED_PRIVATE_KEY]"],
  [/\bAKIA[0-9A-Z]{16}\b/g, "[REDACTED_AWS_KEY]"],
  [/\bgh[pousr]_[A-Za-z0-9]{36,}\b/g, "[REDACTED_GITHUB_TOKEN]"],
  [/\bgithub_pat_[A-Za-z0-9_]{50,}\b/g, "[REDACTED_GITHUB_TOKEN]"],
  [/\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{20,}\b/g, "[REDACTED_API_KEY]"],
  [/\bxox[abpr]-[A-Za-z0-9-]{10,}\b/g, "[REDACTED_SLACK_TOKEN]"],
  [/\bAIza[0-9A-Za-z_-]{35}\b/g, "[REDACTED_GOOGLE_KEY]"],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, "[REDACTED_JWT]"],
  [/(AccountKey|SharedAccessKey|Password|Pwd)=([^;"'\s]+)/gi, "$1=[REDACTED]"],
  [/(\b[a-z][a-z0-9+.-]*:\/\/[^:\s/@]+:)([^@\s]+)@/gi, "$1[REDACTED]@"],
  [
    /((?:password|passwd|secret|api[_-]?key|access[_-]?token|client[_-]?secret|private[_-]?key)["']?\s*[:=]\s*["'])([^"'\s]{6,})(["'])/gi,
    "$1[REDACTED]$3",
  ],
];

export function redactSecrets(text: string): { text: string; count: number } {
  let count = 0;
  let out = text;
  for (const [re, replacement] of PATTERNS) {
    out = out.replace(re, (...args) => {
      count++;
      const groups = args.slice(1, -2) as string[];
      return replacement.replace(/\$(\d)/g, (_, i) => groups[Number(i) - 1] ?? "");
    });
  }
  return { text: out, count };
}
