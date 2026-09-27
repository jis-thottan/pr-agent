import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { parseAdoEvent, parseGitHubEvent, verifyBasicAuth, verifyGitHubSignature } from "../src/server/webhooks/events.ts";
import { carryForward, shaMap, splitBySha } from "../src/server/review/incremental.ts";
import { buildChatContext, mentionedPaths } from "../src/server/chat/context.ts";

test("GitHub signatures are verified against the raw body", () => {
  const body = '{"action":"opened"}';
  const sig = "sha256=" + crypto.createHmac("sha256", "s3cret").update(body).digest("hex");
  assert.ok(verifyGitHubSignature("s3cret", body, sig));
  assert.ok(!verifyGitHubSignature("wrong", body, sig));
  assert.ok(!verifyGitHubSignature("s3cret", body + " ", sig));
  assert.ok(!verifyGitHubSignature("s3cret", body, null));
});

test("Azure DevOps basic auth compares only the password", () => {
  const h = (u: string, p: string) => "Basic " + Buffer.from(`${u}:${p}`).toString("base64");
  assert.ok(verifyBasicAuth("s3cret", h("anyone", "s3cret")));
  assert.ok(verifyBasicAuth("a:b", h("user", "a:b")), "colons in the password are allowed");
  assert.ok(!verifyBasicAuth("s3cret", h("s3cret", "nope")));
  assert.ok(!verifyBasicAuth("s3cret", "Bearer s3cret"));
});

test("GitHub pull_request events map to opened / pushed / ignored", () => {
  const base = { number: 5, repository: { name: "web", owner: { login: "acme" } }, pull_request: { state: "open", draft: false, head: { sha: "abc" } } };
  assert.deepEqual(parseGitHubEvent("pull_request", { ...base, action: "opened" }), { kind: "opened", owner: "acme", repo: "web", number: 5, headSha: "abc", draft: false });
  assert.equal(parseGitHubEvent("pull_request", { ...base, action: "synchronize" }).kind, "pushed");
  assert.equal(parseGitHubEvent("pull_request", { ...base, action: "labeled" }).kind, "ignored");
  assert.equal(parseGitHubEvent("pull_request", { ...base, action: "opened", pull_request: { state: "closed" } }).kind, "ignored");
  assert.equal(parseGitHubEvent("ping", {}).kind, "ping");
  assert.equal(parseGitHubEvent("push", {}).kind, "ignored");
});

test("Azure DevOps service hook payloads are normalised", () => {
  const resource = { pullRequestId: 7, status: "active", isDraft: true, repository: { name: "web", project: { name: "Proj One" } }, lastMergeSourceCommit: { commitId: "h1" } };
  assert.deepEqual(parseAdoEvent({ eventType: "git.pullrequest.created", resource }), { kind: "opened", owner: "Proj One", repo: "web", number: 7, headSha: "h1", draft: true });
  assert.equal(parseAdoEvent({ eventType: "git.pullrequest.updated", resource }).kind, "pushed");
  assert.equal(parseAdoEvent({ eventType: "git.pullrequest.updated", resource: { ...resource, status: "completed" } }).kind, "ignored");
  assert.equal(parseAdoEvent({ eventType: "git.push", resource }).kind, "ignored");
});

test("incremental review splits files by blob SHA and carries findings forward", () => {
  const prev = { "a.ts": "1", "b.ts": "2", "gone.ts": "9" };
  const files = [{ path: "a.ts", sha: "1" }, { path: "b.ts", sha: "3" }, { path: "c.ts", sha: "4" }, { path: "d.bin", sha: null }];
  const { changed, unchanged } = splitBySha(files, prev);
  assert.deepEqual(unchanged.map((f) => f.path), ["a.ts"]);
  assert.deepEqual(changed.map((f) => f.path), ["b.ts", "c.ts", "d.bin"]);
  assert.deepEqual(shaMap(files), { "a.ts": "1", "b.ts": "3", "c.ts": "4" });

  const carried = carryForward(
    [
      { id: "f1", path: "a.ts", line: 10, endLine: 12, inDiff: true },
      { id: "f2", path: "a.ts", line: 50, endLine: null, inDiff: true },
      { id: "f3", path: "b.ts", line: 1, endLine: null, inDiff: true },
    ],
    new Set(["a.ts"]),
    new Map([["a.ts", new Set([10, 11, 12])]]),
  );
  assert.deepEqual(carried.map((f) => [f.carriedFromId, f.inDiff, f.endLine]), [["f1", true, 12], ["f2", false, null]]);
});

test("chat context puts the open and mentioned files first and reports what was left out", () => {
  const patch = (n: number) => "@@ -1,1 +1,1 @@\n-x\n+" + "y".repeat(n);
  const files = [
    { path: "src/big.ts", status: "modified", additions: 1, deletions: 1, patch: patch(3000) },
    { path: "src/small.ts", status: "modified", additions: 1, deletions: 1, patch: patch(10) },
    { path: "src/auth/session.ts", status: "modified", additions: 1, deletions: 1, patch: patch(2000) },
    { path: "README.md", status: "modified", additions: 1, deletions: 1, patch: patch(2500) },
  ];
  assert.deepEqual(mentionedPaths("Is session.ts safe?", files.map((f) => f.path)), ["src/auth/session.ts"]);
  const ctx = buildChatContext({
    title: "T",
    description: "",
    files,
    findings: [{ path: "src/small.ts", line: 1, severity: "major", title: "Bug", state: "pending" }],
    question: "Is session.ts safe?",
    focusPath: "README.md",
    budget: 6500,
  });
  assert.deepEqual(ctx.included.slice(0, 2), ["README.md", "src/auth/session.ts"]);
  assert.ok(ctx.omitted.includes("src/big.ts"));
  assert.match(ctx.text, /\[major\] src\/small\.ts:1: Bug/);
  assert.ok(ctx.text.length <= 6500 + 300);
});

test("isRetryable treats 4xx as final and network/5xx/429 as transient", async () => {
  const { isRetryableStatus } = await import("../src/server/jobs/retry.ts");
  assert.ok(isRetryableStatus(undefined));
  assert.ok(isRetryableStatus(503));
  assert.ok(isRetryableStatus(429));
  assert.ok(!isRetryableStatus(402));
  assert.ok(!isRetryableStatus(400));
});
