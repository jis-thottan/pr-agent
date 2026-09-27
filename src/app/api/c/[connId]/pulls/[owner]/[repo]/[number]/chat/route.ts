import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/server/db";
import { route } from "@/server/http";
import { getConnection } from "@/server/scm";
import { prParams, type PrCtx } from "@/server/pr";
import { askAboutPr, listChat } from "@/server/chat";

export const GET = route<PrCtx>(async (_req, { user, params }) => {
  const { connId, prKey } = await prParams(params);
  await getConnection(user.id, connId);
  return { messages: await listChat(user.id, connId, prKey) };
});

const body = z.object({
  providerId: z.string().uuid(),
  question: z.string().trim().min(1).max(8000),
  focusPath: z.string().max(1000).nullish(),
});

export const POST = route<PrCtx>(async (req, { user, params }) => {
  const { connId, owner, repo, number, prKey } = await prParams(params);
  const input = body.parse(await req.json());
  const { conn } = await getConnection(user.id, connId);
  return askAboutPr({ userId: user.id, conn, owner, repo, number, prKey, ...input });
});

/** Clears this PR's conversation. */
export const DELETE = route<PrCtx>(async (_req, { user, params }) => {
  const { connId, prKey } = await prParams(params);
  const db = await getDb();
  await db
    .delete(schema.chatMessages)
    .where(and(eq(schema.chatMessages.userId, user.id), eq(schema.chatMessages.connectionId, connId), eq(schema.chatMessages.prKey, prKey)));
});
