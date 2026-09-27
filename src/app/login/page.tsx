import { redirect } from "next/navigation";
import { asc, count, eq } from "drizzle-orm";
import { getAuthSettings } from "@/server/auth/settings";
import { getDb, schema } from "@/server/db";
import { getCurrentUser } from "@/server/auth/session";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; next?: string }> }) {
  const q = await searchParams;
  if (await getCurrentUser()) redirect("/");
  const db = await getDb();
  const [{ n }] = await db.select({ n: count() }).from(schema.users);
  const sso = await db
    .select({ id: schema.ssoProviders.id, name: schema.ssoProviders.name, kind: schema.ssoProviders.kind })
    .from(schema.ssoProviders)
    .where(eq(schema.ssoProviders.enabled, true))
    .orderBy(asc(schema.ssoProviders.name));
  const { localLogin } = await getAuthSettings();
  return (
    <LoginForm
      firstRun={n === 0}
      allowRegistration={process.env.ALLOW_REGISTRATION === "true" && localLogin}
      sso={sso}
      localLogin={localLogin}
      error={q.error ?? null}
      next={q.next?.startsWith("/") && !q.next.startsWith("//") ? q.next : "/"}
    />
  );
}
