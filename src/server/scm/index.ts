import "server-only";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "../db";
import { decrypt } from "../crypto";
import { HttpError } from "../http";
import type { ScmConnection } from "../db/schema";
import { AzureDevOpsProvider } from "./azure-devops";
import { GitHubProvider } from "./github";
import { entraAccessToken, githubInstallationToken } from "./app-auth";
import type { ScmProvider } from "./types";

type ConnLike = Pick<ScmConnection, "provider" | "baseUrl" | "encryptedToken"> &
  Partial<Pick<ScmConnection, "id" | "authType" | "appId" | "installationId" | "accountLogin">>;

export function providerFor(conn: ConnLike): ScmProvider {
  const authType = conn.authType ?? "pat";
  if (conn.provider === "github") {
    if (authType === "github_app") {
      if (!conn.installationId) throw new HttpError(500, "This GitHub App connection has no installation");
      return new GitHubProvider(githubInstallationToken(conn.appId ?? null, conn.installationId), conn.baseUrl, {
        installation: { reviewerLogin: conn.accountLogin ?? null },
      });
    }
    return new GitHubProvider(decrypt(conn.encryptedToken), conn.baseUrl);
  }
  if (authType === "entra_oauth") {
    if (!conn.id) throw new HttpError(500, "This connection has no id");
    return new AzureDevOpsProvider({ bearer: entraAccessToken({ id: conn.id, appId: conn.appId ?? null, encryptedToken: conn.encryptedToken }), scope: conn.id }, conn.baseUrl);
  }
  return new AzureDevOpsProvider({ pat: decrypt(conn.encryptedToken) }, conn.baseUrl);
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
