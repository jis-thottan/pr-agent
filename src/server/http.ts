import "server-only";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { getCurrentUser, type SessionUser } from "./auth/session";
import { can, type Permission } from "@/lib/permissions";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

type Handler<C> = (req: Request, ctx: C & { user: SessionUser }) => Promise<Response | unknown>;

export function requirePermission(user: SessionUser, perm: Permission) {
  if (!can(user.role, perm)) throw new HttpError(403, `Your role (${user.role}) can't do this`);
}

/**
 * Wraps a route handler with auth, JSON serialisation and error mapping.
 * `perm` defaults to "read" for GET and "review" for mutations.
 */
export function route<C>(handler: Handler<C>, opts: { perm?: Permission } = {}) {
  return async (req: Request, ctx: C): Promise<Response> => {
    try {
      const user = await getCurrentUser();
      if (!user) throw new HttpError(401, "Not signed in");
      requirePermission(user, opts.perm ?? (req.method === "GET" ? "read" : "review"));
      // Basic CSRF defence for cookie-authenticated mutations.
      if (req.method !== "GET" && req.headers.get("x-requested-with") !== "fetch") {
        throw new HttpError(403, "Missing X-Requested-With header");
      }
      const result = await handler(req, { ...ctx, user });
      return result instanceof Response ? result : NextResponse.json(result ?? { ok: true });
    } catch (err) {
      return errorResponse(err);
    }
  };
}

export function errorResponse(err: unknown): Response {
  if (err instanceof HttpError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (err instanceof ZodError) {
    return NextResponse.json(
      { error: err.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ") },
      { status: 400 },
    );
  }
  const status = (err as { status?: number })?.status;
  const message = err instanceof Error ? err.message : String(err);
  console.error("[pr-review-ai]", err);
  if (status === 401 || status === 403 || status === 404 || status === 422) {
    return NextResponse.json({ error: `Upstream error (${status}): ${message}` }, { status: 502 });
  }
  return NextResponse.json({ error: message }, { status: 500 });
}

export async function audit(userId: string | null, action: string, details: Record<string, unknown> = {}) {
  const { getDb, schema } = await import("./db");
  const db = await getDb();
  await db.insert(schema.auditLog).values({ userId, action, details });
}
