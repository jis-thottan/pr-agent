import { NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";
import { getDb, schema } from "@/server/db";

/** Enabled sign-in providers for the login page (public). */
export async function GET() {
  const db = await getDb();
  const providers = await db
    .select({ id: schema.ssoProviders.id, name: schema.ssoProviders.name, kind: schema.ssoProviders.kind })
    .from(schema.ssoProviders)
    .where(eq(schema.ssoProviders.enabled, true))
    .orderBy(asc(schema.ssoProviders.name));
  return NextResponse.json({ providers });
}
