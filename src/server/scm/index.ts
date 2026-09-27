import "server-only";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "../db";
import { decrypt } from "../crypto";
import { HttpError } from "../http";
import type { ScmConnection } from "../db/schema";
import { AzureDevOpsProvider } from "./azure-devops";
import { GitHubProvider } from "./github";
import type { ScmProvider } from "./types";

export function providerFor(conn: Pick<ScmConnection, "provider" | "baseUrl" | "encryptedToken">): ScmProvider {
  const token = decrypt(conn.encryptedToken);
  switch (conn.provider) {
    case "github":
      return new GitHubProvider(token, conn.baseUrl);
    case "azure_devops":
      return new AzureDevOpsProvider(token, conn.baseUrl);
  }
}

/** Loads a connection owned by `userId` and returns it with its provider client. */
export async function getConnection(userId: string, connectionId: string) {
  const db = await getDb();
  const [conn] = await db
    .select()
    .from(schema.scmConnections)
    .where(and(eq(schema.scmConnections.id, connectionId), eq(schema.scmConnections.userId, userId)))
    .limit(1);
  if (!conn) throw new HttpError(404, "Connection not found");
  return { conn, scm: providerFor(conn) };
}
