import { redirect } from "next/navigation";
import { count } from "drizzle-orm";
import { getDb, schema } from "@/server/db";
import { getCurrentUser } from "@/server/auth/session";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (await getCurrentUser()) redirect("/");
  const db = await getDb();
  const [{ n }] = await db.select({ n: count() }).from(schema.users);
  return <LoginForm firstRun={n === 0} allowRegistration={process.env.ALLOW_REGISTRATION === "true"} />;
}
