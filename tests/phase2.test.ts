import { test } from "node:test";
import assert from "node:assert/strict";
import { diffLines, unifiedDiff } from "../src/lib/unified-diff.ts";
import { commentableLines, parsePatch } from "../src/lib/diff.ts";
import { instructionsForPaths, meetsSeverity, parseRepoRules, stricterSeverity } from "../src/server/review/rules.ts";

test("unifiedDiff produces hunks parsePatch numbers correctly", () => {
  const oldText = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join("\n") + "\n";
  const lines = oldText.split("\n");
  lines[4] = "changed 5";
  lines.splice(15, 0, "inserted");
  const newText = lines.join("\n");
  const { patch, additions, deletions } = unifiedDiff(oldText, newText);
  assert.equal(additions, 2);
  assert.equal(deletions, 1);
  const hunks = parsePatch(patch);
  assert.equal(hunks.length, 2, "distant changes form separate hunks");
  const newLines = newText.split("\n");
  for (const h of hunks) for (const l of h.lines) if (l.newLine !== null) assert.equal(l.content, newLines[l.newLine - 1]);
  assert.ok(commentableLines(hunks).has(16));
});

test("unifiedDiff handles added, deleted and unchanged files", () => {
  assert.match(unifiedDiff("", "a\nb\n").patch, /^@@ -0,0 \+1,2 @@\n\+a\n\+b$/);
  assert.match(unifiedDiff("a\nb\n", "").patch, /^@@ -1,2 \+0,0 @@\n-a\n-b$/);
  assert.equal(unifiedDiff("same\n", "same\n").patch, "");
  assert.equal(unifiedDiff("a\r\nb\r\n", "a\nb\n").patch, "", "CRLF vs LF is not a content change");
});

test("diffLines edit scripts reconstruct both sides (fuzz)", () => {
  let seed = 42;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  for (let t = 0; t < 500; t++) {
    const a = Array.from({ length: Math.floor(rand() * 40) }, () => "abcd"[Math.floor(rand() * 4)]);
    const b = Array.from({ length: Math.floor(rand() * 40) }, () => "abcd"[Math.floor(rand() * 4)]);
    const ops = diffLines(a, b);
    assert.deepEqual(ops.filter((o) => o.type !== "add").map((o) => a[o.a]), a);
    assert.deepEqual(ops.filter((o) => o.type !== "del").map((o) => (o.type === "eq" ? a[o.a] : b[o.b])), b);
  }
});

test("parseRepoRules reads every supported key", () => {
  const { rules, warnings } = parseRepoRules(`
instructions: |
  Use Result<T>, not exceptions.
ignore:
  - "**/*.generated.ts"
  - docs/**
min_severity: Minor
full_file_context: false
path_instructions:
  - path: "src/api/**"
    instructions: Every handler must check authorization.
  - path: ["**/*.sql", "migrations/**"]
    instructions: Migrations must be reversible.
`);
  assert.deepEqual(warnings, []);
  assert.equal(rules?.instructions, "Use Result<T>, not exceptions.");
  assert.deepEqual(rules?.ignore, ["**/*.generated.ts", "docs/**"]);
  assert.equal(rules?.minSeverity, "minor");
  assert.equal(rules?.fullFileContext, false);
  assert.equal(rules?.pathInstructions.length, 3);
});

test("parseRepoRules keeps valid keys and warns about the rest", () => {
  const { rules, warnings } = parseRepoRules("ignore: vendor/**\nmin_severity: blocker\ncolour: blue\n");
  assert.deepEqual(rules?.ignore, ["vendor/**"]);
  assert.equal(rules?.minSeverity, null);
  assert.equal(warnings.length, 2);
  assert.equal(parseRepoRules("foo: [unclosed").rules, null);
  assert.equal(parseRepoRules("- just\n- a list\n").rules, null);
});

test("path instructions match globs and severity helpers pick the stricter threshold", () => {
  const rules = { pathInstructions: [{ path: "src/api/**", instructions: "Check authz." }, { path: "**/*.sql", instructions: "Reversible." }] };
  const text = instructionsForPaths(rules, ["src/api/users.ts", "README.md"]);
  assert.match(text!, /src\/api\/users\.ts/);
  assert.doesNotMatch(text!, /Reversible/);
  assert.equal(instructionsForPaths(rules, ["README.md"]), null);
  assert.equal(stricterSeverity("nit", "major"), "major");
  assert.equal(stricterSeverity(null, "minor"), "minor");
  assert.ok(meetsSeverity("critical", "major"));
  assert.ok(!meetsSeverity("nit", "minor"));
  assert.ok(meetsSeverity("nit", null));
});
