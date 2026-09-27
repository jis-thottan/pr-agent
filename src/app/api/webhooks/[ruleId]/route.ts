import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/server/db";
import { decrypt } from "@/server/crypto";
import { enqueue } from "@/server/jobs/queue";
import { parseAdoEvent, parseGitHubEvent, verifyBasicAuth, verifyGitHubSignature, type PrEvent } from "@/server/webhooks/events";

const MAX_BODY = 5 * 1024 * 1024;

const reply = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status });

/**
 * Public webhook receiver (no session). The URL names the rule; the signature (GitHub) or
 * basic-auth password (Azure DevOps) proves the sender knows the rule's secret.
 */
export async function POST(req: Request, { params }: { params: Promise<{ ruleId: string }> }) {
  const { ruleId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(ruleId)) return reply(404, { error: "Unknown webhook" });
  const db = await getDb();
  const [row] = await db
    .select({ rule: schema.autoReviewRules, provider: schema.scmConnections.provider })
    .from(schema.autoReviewRules)
    .innerJoin(schema.scmConnections, eq(schema.scmConnections.id, schema.autoReviewRules.connectionId))
    .where(eq(schema.autoReviewRules.id, ruleId))
    .limit(1);
  if (!row) return reply(404, { error: "Unknown webhook" });
  const { rule, provider } = row;

  const raw = await req.text();
  if (raw.length > MAX_BODY) return reply(413, { error: "Payload too large" });
  const secret = decrypt(rule.encryptedSecret);
  const ok =
    provider === "github"
      ? verifyGitHubSignature(secret, raw, req.headers.get("x-hub-signature-256"))
      : verifyBasicAuth(secret, req.headers.get("authorization"));
  if (!ok) return reply(401, { error: "Invalid signature" });

  await db.update(schema.autoReviewRules).set({ lastDeliveryAt: new Date() }).where(eq(schema.autoReviewRules.id, rule.id));

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return reply(400, { error: "Body is not JSON" });
  }
  const event: PrEvent = provider === "github" ? parseGitHubEvent(req.headers.get("x-github-event"), payload) : parseAdoEvent(payload);

  if (event.kind === "ping") return reply(200, { ok: true, message: "Webhook configured" });
  if (event.kind === "ignored") return reply(202, { queued: false, reason: event.reason });
  if (!rule.enabled) return reply(202, { queued: false, reason: "automatic reviews are paused for this repository" });
  if (event.owner.toLowerCase() !== rule.owner.toLowerCase() || event.repo.toLowerCase() !== rule.repo.toLowerCase()) {
    return reply(202, { queued: false, reason: `this webhook is for ${rule.owner}/${rule.repo}` });
  }
  if (event.kind === "opened" && !rule.onOpen) return reply(202, { queued: false, reason: "new pull requests are not reviewed automatically" });
  if (event.kind === "pushed" && !rule.onPush) return reply(202, { queued: false, reason: "pushes are not reviewed automatically" });
  if (event.draft && rule.skipDrafts) return reply(202, { queued: false, reason: "draft pull request" });

  // The job re-checks the PR's current head, so a missing SHA only weakens de-duplication.
  const jobId = await enqueue(
    "auto_review",
    { ruleId: rule.id, number: event.number },
    { dedupeKey: `auto:${rule.id}:${event.number}:${event.headSha ?? Date.now()}` },
  );
  return reply(202, { queued: Boolean(jobId), ...(jobId ? {} : { reason: "already queued for this commit" }) });
}
