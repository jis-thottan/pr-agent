import crypto from "node:crypto";

// Normalises GitHub and Azure DevOps pull request webhooks into one shape.

export type PrEvent =
  | { kind: "ping" }
  | { kind: "ignored"; reason: string }
  | { kind: "opened" | "pushed"; owner: string; repo: string; number: number; headSha: string | null; draft: boolean };

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/** GitHub: X-Hub-Signature-256 is "sha256=" + HMAC-SHA256(secret, raw body). */
export function verifyGitHubSignature(secret: string, rawBody: string, header: string | null) {
  if (!header?.startsWith("sha256=")) return false;
  const expected = "sha256=" + crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  return safeEqual(expected, header);
}

/** Azure DevOps service hooks send HTTP basic auth; the password must equal the rule's secret. */
export function verifyBasicAuth(secret: string, header: string | null) {
  if (!header?.toLowerCase().startsWith("basic ")) return false;
  const decoded = Buffer.from(header.slice(6).trim(), "base64").toString("utf8");
  const password = decoded.slice(decoded.indexOf(":") + 1);
  return decoded.includes(":") && safeEqual(password, secret);
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" ? (v as Obj) : {});
const str = (v: unknown) => (typeof v === "string" ? v : null);

export function parseGitHubEvent(event: string | null, payload: unknown): PrEvent {
  if (event === "ping") return { kind: "ping" };
  if (event !== "pull_request") return { kind: "ignored", reason: `event "${event}" is not handled` };
  const p = obj(payload);
  const pr = obj(p.pull_request);
  const repo = obj(p.repository);
  const action = str(p.action);
  const kind = action === "opened" || action === "reopened" || action === "ready_for_review" ? "opened" : action === "synchronize" ? "pushed" : null;
  if (!kind) return { kind: "ignored", reason: `action "${action}" is not handled` };
  if (str(pr.state) !== "open") return { kind: "ignored", reason: "pull request is not open" };
  const number = Number(p.number ?? pr.number);
  const owner = str(obj(repo.owner).login);
  const name = str(repo.name);
  if (!owner || !name || !Number.isInteger(number)) return { kind: "ignored", reason: "payload is missing the repository or PR number" };
  return { kind, owner, repo: name, number, headSha: str(obj(pr.head).sha), draft: Boolean(pr.draft) };
}

export function parseAdoEvent(payload: unknown): PrEvent {
  const p = obj(payload);
  const type = str(p.eventType);
  const kind = type === "git.pullrequest.created" ? "opened" : type === "git.pullrequest.updated" ? "pushed" : null;
  if (!kind) return { kind: "ignored", reason: `event "${type}" is not handled` };
  const r = obj(p.resource);
  if (str(r.status) !== "active") return { kind: "ignored", reason: "pull request is not active" };
  const repo = obj(r.repository);
  const owner = str(obj(repo.project).name);
  const name = str(repo.name);
  const number = Number(r.pullRequestId);
  if (!owner || !name || !Number.isInteger(number)) return { kind: "ignored", reason: "payload is missing the repository or PR number" };
  return { kind, owner, repo: name, number, headSha: str(obj(r.lastMergeSourceCommit).commitId), draft: Boolean(r.isDraft) };
}
