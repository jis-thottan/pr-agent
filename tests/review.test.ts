import { test } from "node:test";
import assert from "node:assert/strict";
import { commentableLines, formatPatchForPrompt, parsePatch, snapToCommentable } from "../src/lib/diff.ts";
import { extractJson, parseFindings, parseSummary } from "../src/server/review/parse.ts";
import { buildBatches } from "../src/server/review/chunk.ts";
import { redactSecrets } from "../src/server/review/redact.ts";
import { createFileFilter } from "../src/server/review/filter.ts";

const PATCH = `@@ -1,4 +1,5 @@
 import a from "a";
-const x = 1;
+const x = 2;
+const y = 3;
 export { x };
@@ -20,2 +21,3 @@ function foo() {
   return 1;
+  // added
 }
`;

test("parsePatch numbers old and new lines", () => {
  const hunks = parsePatch(PATCH);
  assert.equal(hunks.length, 2);
  assert.deepEqual(
    hunks[0].lines.map((l) => [l.type, l.oldLine, l.newLine]),
    [["ctx", 1, 1], ["del", 2, null], ["add", null, 2], ["add", null, 3], ["ctx", 3, 4]],
  );
  assert.equal(hunks[1].lines.at(-1)!.newLine, 23);
  assert.equal(hunks[1].lines.length, 3, "trailing newline must not create a phantom line");
});

test("commentable lines and snapping", () => {
  const lines = commentableLines(parsePatch(PATCH));
  assert.ok(lines.has(2) && lines.has(22) && !lines.has(10));
  assert.equal(snapToCommentable(10, lines), null);
  assert.equal(snapToCommentable(24, lines), 23);
});

test("formatPatchForPrompt shows new-file line numbers", () => {
  const text = formatPatchForPrompt(parsePatch(PATCH));
  assert.match(text, /^\s+2 \+ const x = 2;$/m);
  assert.match(text, /^\s+- const x = 1;$/m);
});

test("extractJson tolerates fences, prose and think blocks", () => {
  assert.deepEqual(extractJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(extractJson('Here you go: {"a":[1,2]} hope that helps'), { a: [1, 2] });
  assert.deepEqual(extractJson('<think>{"no":1}</think>{"findings":[]}'), { findings: [] });
  assert.throws(() => extractJson("no json here"));
});

test("parseFindings normalises aliases and drops invalid items", () => {
  const out = parseFindings(
    JSON.stringify({
      findings: [
        { path: "./a.ts", line: "12", severity: "HIGH", category: "correctness", title: "Bad", body: "Explain" },
        { file: "b.ts", severity: "weird", message: "Only message" },
        { nothing: true },
      ],
    }),
  );
  assert.equal(out.length, 2);
  assert.equal(out[0].severity, "major");
  assert.equal(out[0].category, "bug");
  assert.equal(out[0].line, 12);
  assert.equal(out[1].severity, "minor");
  assert.equal(out[1].title, "Only message");
});

test("parseSummary falls back to raw text", () => {
  assert.equal(parseSummary("just prose").summary, "just prose");
  assert.equal(parseSummary('{"summary":"ok","riskLevel":"HIGH","verdict":"request changes"}').verdict, "request_changes");
});

test("buildBatches splits large files and packs small ones", () => {
  const big = "@@ -1,1 +1,400 @@\n" + Array.from({ length: 400 }, (_, i) => `+line ${i} ${"x".repeat(40)}`).join("\n");
  const batches = buildBatches(
    [
      { path: "small1.ts", previousPath: null, status: "modified", patch: PATCH },
      { path: "small2.ts", previousPath: null, status: "modified", patch: PATCH },
      { path: "big.ts", previousPath: null, status: "added", patch: big },
    ],
    6000,
  );
  assert.ok(batches.length >= 3);
  assert.deepEqual(batches[0].paths, ["small1.ts", "small2.ts"]);
  for (const b of batches) assert.ok(b.text.length <= 6000, `batch too large: ${b.text.length}`);
});

test("redactSecrets masks common credentials", () => {
  const { text, count } = redactSecrets(
    [
      'const key = "AKIAABCDEFGHIJKLMNOP";',
      "token: ghp_" + "a".repeat(36),
      'password = "hunter2hunter2"',
      "Server=db;User Id=sa;Password=S3cret!;",
      "postgres://user:pa55word@host/db",
    ].join("\n"),
  );
  assert.equal(count, 5);
  assert.doesNotMatch(text, /AKIAABCDEFGHIJKLMNOP|hunter2|S3cret|pa55word|ghp_a/);
});

test("file filter skips lockfiles, deletions and binaries", () => {
  const skip = createFileFilter(["docs/**"]);
  assert.equal(skip({ path: "web/package-lock.json", status: "modified", patch: "x" }), "ignored");
  assert.equal(skip({ path: "docs/readme.md", status: "modified", patch: "x" }), "ignored");
  assert.equal(skip({ path: "a.ts", status: "removed", patch: "x" }), "removed");
  assert.equal(skip({ path: "img.bin", status: "added", patch: null }), "no-diff");
  assert.equal(skip({ path: "src/a.ts", status: "modified", patch: "x" }), null);
});
