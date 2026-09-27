import { and, desc, eq, ilike, lt, or, sql, type SQL } from "drizzle-orm";
import { getDb, schema } from "@/server/db";
import { route } from "@/server/http";

const PAGE = 50;

/** Audit log, newest first, keyset-paginated by `before` (an ISO timestamp). */
export const GET = route(async (req) => {
  const q = new URL(req.url).searchParams;
  const conds: SQL[] = [];
  const action = q.get("action");
  if (action) conds.push(action.endsWith(".") ? ilike(schema.auditLog.action, `${action}%`) : eq(schema.auditLog.action, action));
  const userId = q.get("userId");
  if (userId) conds.push(eq(schema.auditLog.userId, userId));
  const text = q.get("q")?.trim();
  if (text) {
    const like = `%${text.replace(/[%_\\]/g, "\\$&")}%`;
    conds.push(or(ilike(sql`${schema.auditLog.details}::text`, like), ilike(schema.users.email, like))!);
  }
  const before = q.get("before");
  if (before && !Number.isNaN(Date.parse(before))) conds.push(lt(schema.auditLog.createdAt, new Date(before)));
  const since = q.get("since");
  if (since && !Number.isNaN(Date.parse(since))) conds.push(sql`${schema.auditLog.createdAt} >= ${new Date(since)}`);

  const db = await getDb();
  const rows = await db
    .select({
      id: schema.auditLog.id,
      action: schema.auditLog.action,
      details: schema.auditLog.details,
      createdAt: schema.auditLog.createdAt,
      userId: schema.auditLog.userId,
      userName: schema.users.name,
      userEmail: schema.users.email,
    })
    .from(schema.auditLog)
    .leftJoin(schema.users, eq(schema.users.id, schema.auditLog.userId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(schema.auditLog.createdAt))
    .limit(PAGE + 1);
  const actions = await db.selectDistinct({ action: schema.auditLog.action }).from(schema.auditLog).orderBy(schema.auditLog.action);
  return {
    entries: rows.slice(0, PAGE),
    next: rows.length > PAGE ? rows[PAGE - 1].createdAt : null,
    actions: actions.map((a) => a.action),
  };
}, { perm: "audit" });
