import { asc, eq } from "drizzle-orm";
import { getDb, schema } from "@/server/db";
import { route } from "@/server/http";

export const GET = route(async () => {
  const db = await getDb();
  const [users, identities] = await Promise.all([
    db
      .select({
        id: schema.users.id,
        email: schema.users.email,
        name: schema.users.name,
        role: schema.users.role,
        hasPassword: schema.users.passwordHash,
        disabledAt: schema.users.disabledAt,
        lastLoginAt: schema.users.lastLoginAt,
        createdAt: schema.users.createdAt,
      })
      .from(schema.users)
      .orderBy(asc(schema.users.name)),
    db
      .select({ userId: schema.userIdentities.userId, provider: schema.ssoProviders.name })
      .from(schema.userIdentities)
      .innerJoin(schema.ssoProviders, eq(schema.ssoProviders.id, schema.userIdentities.providerId)),
  ]);
  return {
    users: users.map((u) => ({
      ...u,
      hasPassword: Boolean(u.hasPassword),
      sso: identities.filter((i) => i.userId === u.id).map((i) => i.provider),
    })),
  };
}, { perm: "manageUsers" });
