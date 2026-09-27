import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { count } from "drizzle-orm";
import { getDb, schema } from "@/server/db";
import { createSession } from "@/server/auth/session";
import { getAuthSettings } from "@/server/auth/settings";
import { audit, errorResponse, HttpError } from "@/server/http";

const body = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(10, "Password must be at least 10 characters").max(200),
});

export async function POST(req: Request) {
  try {
    const input = body.parse(await req.json());
    const db = await getDb();
    const [{ n }] = await db.select({ n: count() }).from(schema.users);
    const isFirst = n === 0;
    if (!isFirst && process.env.ALLOW_REGISTRATION !== "true") {
      throw new HttpError(403, "Registration is disabled. Ask an admin to enable ALLOW_REGISTRATION.");
    }
    if (!isFirst && !(await getAuthSettings()).localLogin) {
      throw new HttpError(403, "Password accounts are turned off. Sign in with single sign-on.");
    }
    const [user] = await db
      .insert(schema.users)
      .values({
        name: input.name,
        email: input.email,
        passwordHash: await bcrypt.hash(input.password, 12),
        role: isFirst ? "admin" : "reviewer",
      })
      .onConflictDoNothing()
      .returning();
    if (!user) throw new HttpError(409, "An account with that email already exists");
    await createSession(user.id);
    await audit(user.id, "user.register", { role: user.role });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
