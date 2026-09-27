import { z } from "zod";
import { getDb, schema } from "@/server/db";
import { encrypt, randomToken } from "@/server/crypto";
import { audit, HttpError, route } from "@/server/http";
import { getConnection } from "@/server/scm";
import { assertProviderExists, getVisibleProfile } from "@/server/profiles";
import { listRules, publicBaseUrl, ruleSettings } from "@/server/webhooks/rules";

const body = ruleSettings.extend({
  connectionId: z.string().uuid(),
  owner: z.string().trim().min(1),
  repo: z.string().trim().min(1),
});

export const GET = route(async (req, { user }) => {
  const base = publicBaseUrl(req);
  const rules = await listRules(user.id);
  return { rules: rules.map((r) => ({ ...r, webhookUrl: `${base}/api/webhooks/${r.id}` })), publicUrlSet: Boolean(process.env.PUBLIC_URL) };
});

export const POST = route(async (req, { user }) => {
  const input = body.parse(await req.json());
  await getConnection(user.id, input.connectionId);
  await assertProviderExists(input.providerId);
  if (input.profileId) await getVisibleProfile(user.id, input.profileId);
  const secret = randomToken(24);
  const db = await getDb();
  const [row] = await db
    .insert(schema.autoReviewRules)
    .values({ ...input, userId: user.id, encryptedSecret: encrypt(secret) })
    .onConflictDoNothing()
    .returning({ id: schema.autoReviewRules.id });
  if (!row) throw new HttpError(409, `Automatic reviews are already set up for ${input.owner}/${input.repo} on this connection`);
  await audit(user.id, "auto_review.create", { id: row.id, repo: `${input.owner}/${input.repo}` });
  return { id: row.id, secret, webhookUrl: `${publicBaseUrl(req)}/api/webhooks/${row.id}` };
}, { perm: "autoReview" });
