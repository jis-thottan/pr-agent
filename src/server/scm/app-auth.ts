import "server-only";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../db";
import { decrypt, encrypt } from "../crypto";
import { HttpError } from "../http";
import type { CodeHostApp } from "../db/schema";
import { githubAppJwt } from "./github-jwt";

/** Azure DevOps' resource ID; `.default` requests the user's delegated DevOps permissions. */
export const AZURE_DEVOPS_SCOPE = "499b84ac-1321-427f-aa17-267ca6975798/.default offline_access";

type Cached = { token: string; expires: number };
const tokens = new Map<string, Cached>();

async function loadApp(appId: string | null): Promise<CodeHostApp> {
  if (!appId) throw new HttpError(500, "This connection has no app registration");
  const db = await getDb();
  const [app] = await db.select().from(schema.codeHostApps).where(eq(schema.codeHostApps.id, appId)).limit(1);
  if (!app) throw new HttpError(400, "The app registration for this connection was removed. Reconnect it in Settings.");
  return app;
}

/** Installation access token (1 hour), cached until 5 minutes before it expires. */
export function githubInstallationToken(appRowId: string | null, installationId: string) {
  return async () => {
    const key = `gh:${appRowId}:${installationId}`;
    const hit = tokens.get(key);
    if (hit && hit.expires > Date.now()) return hit.token;
    const app = await loadApp(appRowId);
    if (!app.appId || !app.encryptedPrivateKey) throw new HttpError(500, "The GitHub App is missing its App ID or private key");
    const res = await fetch(`${app.baseUrl.replace(/\/+$/, "")}/app/installations/${encodeURIComponent(installationId)}/access_tokens`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${githubAppJwt(app.appId, decrypt(app.encryptedPrivateKey))}`,
        accept: "application/vnd.github+json",
        "user-agent": "pull-request-ai",
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new HttpError(res.status === 404 ? 400 : 502, `GitHub App token request failed (${res.status}): ${text.slice(0, 200)}. Is the app still installed?`);
    }
    const data = (await res.json()) as { token: string; expires_at: string };
    tokens.set(key, { token: data.token, expires: Date.parse(data.expires_at) - 5 * 60_000 });
    return data.token;
  };
}

export function entraTokenUrl(tenant: string) {
  return `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`;
}

export function entraAuthorizeUrl(tenant: string) {
  return `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/authorize`;
}

/** Token endpoint call shared by the code exchange and refreshes. */
export async function entraTokenRequest(app: CodeHostApp, params: Record<string, string>) {
  // The override exists for tests against a mock identity provider.
  const res = await fetch(process.env.ENTRA_TOKEN_URL_OVERRIDE ?? entraTokenUrl(app.baseUrl), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams({ client_id: app.clientId, client_secret: decrypt(app.encryptedClientSecret), scope: AZURE_DEVOPS_SCOPE, ...params }),
    signal: AbortSignal.timeout(15_000),
  });
  const data = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number; error?: string; error_description?: string };
  if (!res.ok || !data.access_token) {
    throw new HttpError(401, `Microsoft sign-in for Azure DevOps failed: ${data.error_description?.split("\n")[0] ?? data.error ?? res.status}. Reconnect in Settings.`);
  }
  return data as { access_token: string; refresh_token?: string; expires_in?: number };
}

/** Access token for an Entra-connected Azure DevOps connection; refresh tokens rotate and are re-saved. */
export function entraAccessToken(conn: { id: string; appId: string | null; encryptedToken: string }) {
  return async () => {
    const key = `entra:${conn.id}`;
    const hit = tokens.get(key);
    if (hit && hit.expires > Date.now()) return hit.token;
    const app = await loadApp(conn.appId);
    const db = await getDb();
    // Re-read: another request may have rotated the refresh token since this connection row was loaded.
    const [row] = await db.select({ t: schema.scmConnections.encryptedToken }).from(schema.scmConnections).where(eq(schema.scmConnections.id, conn.id)).limit(1);
    const data = await entraTokenRequest(app, { grant_type: "refresh_token", refresh_token: decrypt(row?.t ?? conn.encryptedToken) });
    if (data.refresh_token) {
      await db.update(schema.scmConnections).set({ encryptedToken: encrypt(data.refresh_token) }).where(eq(schema.scmConnections.id, conn.id));
    }
    tokens.set(key, { token: data.access_token, expires: Date.now() + ((data.expires_in ?? 3600) - 300) * 1000 });
    return data.access_token;
  };
}

/** Seeds the cache after the initial code exchange so the first API call doesn't refresh immediately. */
export function primeToken(key: string, token: string, expiresInSec = 3600) {
  tokens.set(key, { token, expires: Date.now() + (expiresInSec - 300) * 1000 });
}
