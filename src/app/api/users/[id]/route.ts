import { z } from "zod";
import { and, count, eq, isNull, ne } from "drizzle-orm";
import { getDb, schema } from "@/server/db";
import { audit, HttpError, route } from "@/server/http";
import { ROLES } from "@/server/db/schema";

const body = z.object({ role: z.enum(ROLES).optional(), disabled: z.boolean().optional() });

export const PATCH = route<{ params: Promise<{ id: string }> }>(async (req, { user, params }) => {
  const { id } = await params;
  const input = body.parse(await req.json());
  const db = await getDb();
  const [target] = await db.select().from(schema.users).where(eq(schema.users.id, id)).limit(1);
  if (!target) throw new HttpError(404, "User not found");
  if (id === user.id && input.disabled) throw new HttpError(400, "You can't deactivate your own account");

  const losesAdmin = target.role === "admin" && !target.disabledAt && ((input.role && input.role !== "admin") || input.disabled);
  if (losesAdmin) {
    const [{ n }] = await db
      .select({ n: count() })
      .from(schema.users)
      .where(and(eq(schema.users.role, "admin"), isNull(schema.users.disabledAt), ne(schema.users.id, id)));
    if (n === 0) throw new HttpError(400, "There must be at least one active admin");
  }

  await db.transaction(async (tx) => {
    await tx
      .update(schema.users)
      .set({
        ...(input.role ? { role: input.role } : {}),
        ...(input.disabled !== undefined ? { disabledAt: input.disabled ? new Date() : null } : {}),
      })
      .where(eq(schema.users.id, id));
    // Deactivating signs the user out everywhere.
    if (input.disabled) await tx.delete(schema.sessions).where(eq(schema.sessions.userId, id));
  });
  await audit(user.id, "user.update", { id, email: target.email, ...input, previousRole: target.role });
}, { perm: "manageUsers" });
