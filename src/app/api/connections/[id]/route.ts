import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/server/db";
import { audit, route } from "@/server/http";

export const DELETE = route<{ params: Promise<{ id: string }> }>(async (_req, { user, params }) => {
  const { id } = await params;
  const db = await getDb();
  await db
    .delete(schema.scmConnections)
    .where(and(eq(schema.scmConnections.id, id), eq(schema.scmConnections.userId, user.id)));
  await audit(user.id, "connection.delete", { id });
}, { perm: "read" });
