import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/server/db";
import { route } from "@/server/http";
import { getConnection } from "@/server/scm";
import { prParams, type PrCtx } from "@/server/pr";

const body = z.object({ path: z.string().min(1), sha: z.string().min(1), viewed: z.boolean() });

export const PUT = route<PrCtx>(async (req, { user, params }) => {
  const { connId, prKey } = await prParams(params);
  await getConnection(user.id, connId); // ownership check
  const input = body.parse(await req.json());
  const db = await getDb();
  const key = and(
    eq(schema.viewedFiles.userId, user.id),
    eq(schema.viewedFiles.connectionId, connId),
    eq(schema.viewedFiles.prKey, prKey),
    eq(schema.viewedFiles.path, input.path),
  );
  if (!input.viewed) {
    await db.delete(schema.viewedFiles).where(key);
    return;
  }
  await db
    .insert(schema.viewedFiles)
    .values({ userId: user.id, connectionId: connId, prKey, path: input.path, sha: input.sha })
    .onConflictDoUpdate({
      target: [schema.viewedFiles.userId, schema.viewedFiles.connectionId, schema.viewedFiles.prKey, schema.viewedFiles.path],
      set: { sha: input.sha },
    });
});
