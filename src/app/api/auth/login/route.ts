import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/server/db";
import { createSession } from "@/server/auth/session";
import { audit, errorResponse, HttpError } from "@/server/http";

const body = z.object({ email: z.string().trim().toLowerCase(), password: z.string() });

// Simple in-memory throttle against password guessing (per email, single instance).
const attempts = new Map<string, { n: number; until: number }>();

export async function POST(req: Request) {
  try {
    const { email, password } = body.parse(await req.json());
    const a = attempts.get(email);
    if (a && a.n >= 5 && a.until > Date.now()) throw new HttpError(429, "Too many attempts. Try again in a few minutes.");
    const db = await getDb();
    const [user] = await db.select().from(schema.users).where(eq(schema.users.email, email)).limit(1);
    const ok = user && (await bcrypt.compare(password, user.passwordHash));
    if (!ok) {
      attempts.set(email, { n: (a?.n ?? 0) + 1, until: Date.now() + 5 * 60_000 });
      throw new HttpError(401, "Invalid email or password");
    }
    attempts.delete(email);
    await createSession(user.id);
    await audit(user.id, "user.login");
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
