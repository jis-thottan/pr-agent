import hljs from "highlight.js/lib/common";
import dockerfile from "highlight.js/lib/languages/dockerfile";

hljs.registerLanguage("dockerfile", dockerfile);

const EXT: Record<string, string> = {
  ts: "typescript", tsx: "typescript", mts: "typescript", cts: "typescript",
  js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript",
  py: "python", rb: "ruby", go: "go", rs: "rust", java: "java", kt: "kotlin", kts: "kotlin",
  cs: "csharp", csx: "csharp", vb: "vbnet", fs: "plaintext",
  c: "c", h: "c", cc: "cpp", cpp: "cpp", cxx: "cpp", hpp: "cpp", m: "objectivec",
  php: "php", swift: "swift", lua: "lua", pl: "perl", r: "r",
  sh: "bash", bash: "bash", zsh: "bash", ps1: "shell",
  yml: "yaml", yaml: "yaml", json: "json", jsonc: "json", toml: "ini", ini: "ini", cfg: "ini", env: "ini",
  md: "markdown", mdx: "markdown", sql: "sql", graphql: "graphql", gql: "graphql",
  xml: "xml", html: "xml", htm: "xml", vue: "xml", svelte: "xml", csproj: "xml", props: "xml", razor: "xml", cshtml: "xml",
  css: "css", scss: "scss", less: "less", mk: "makefile",
};

export function langFor(path: string): string | null {
  const base = path.split("/").pop() ?? "";
  if (/^dockerfile/i.test(base) || base.endsWith(".dockerfile")) return "dockerfile";
  if (base === "Makefile") return "makefile";
  const ext = base.includes(".") ? base.split(".").pop()!.toLowerCase() : "";
  const lang = EXT[ext];
  return lang && hljs.getLanguage(lang) ? lang : null;
}

function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Returns escaped HTML for one line. Highlighting line-by-line keeps diffs cheap and robust. */
export function highlightLine(code: string, lang: string | null): string {
  if (!lang || code.length > 2000) return escapeHtml(code);
  try {
    return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
  } catch {
    return escapeHtml(code);
  }
}
