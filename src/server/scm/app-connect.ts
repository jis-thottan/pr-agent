import "server-only";
import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../db";
import { decrypt, encrypt, randomToken } from "../crypto";
import { audit, HttpError } from "../http";
import type { CodeHostApp } from "../db/schema";
import { AzureDevOpsProvider } from "./azure-devops";
import { AZURE_DEVOPS_SCOPE, entraAuthorizeUrl, entraTokenRequest, primeToken } from "./app-auth";

export const CONNECT_COOKIE = "prai_connect";
const TTL_MS = 15 * 60_000;

type ConnectState = { appId: string; userId: string; state: string; verifier: string; exp: number; name: string; orgUrl?: string };

export function callbackUrl(base: string, appId: string) {
  return `${base}/api/code-host-apps/${appId}/callback`;
}

export async function getApp(id: string) {
  const db = await getDb();
  const [app] = await db.select().from(schema.codeHostApps).where(eq(schema.codeHostApps.id, id)).limit(1);
  if (!app) throw new HttpError(404, "App registration not found");
  return app;
}

/** Where to send the browser to connect, plus the encrypted state cookie. */
export function beginConnect(app: CodeHostApp, userId: string, base: string, opts: { name: string; orgUrl?: string; install?: boolean }) {
  const st: ConnectState = { appId: app.id, userId, state: randomToken(16), verifier: randomToken(32), exp: Date.now() + TTL_MS, name: opts.name, orgUrl: opts.orgUrl };
  let url: URL;
  if (app.kind === "github_app") {
    // Installing sends the user through GitHub's install screen; otherwise just authorize to find existing installations.
    url = opts.install ? new URL(`${app.webUrl}/apps/${app.slug}/installations/new`) : new URL(`${app.webUrl}/login/oauth/authorize`);
    if (!opts.install) {
      url.searchParams.set("client_id", app.clientId);
      url.searchParams.set("redirect_uri", callbackUrl(base, app.id));
    }
    url.searchParams.set("state", st.state);
  } else {
    url = new URL(process.env.ENTRA_AUTHORIZE_URL_OVERRIDE ?? entraAuthorizeUrl(app.baseUrl));
    url.searchParams.set("client_id", app.clientId);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("redirect_uri", callbackUrl(base, app.id));
    url.searchParams.set("scope", AZURE_DEVOPS_SCOPE);
    url.searchParams.set("state", st.state);
    url.searchParams.set("code_challenge", crypto.createHash("sha256").update(st.verifier).digest("base64url"));
    url.searchParams.set("code_challenge_method", "S256");
  }
  return { url: url.toString(), cookie: encrypt(JSON.stringify(st)) };
}

function readState(cookie: string | undefined, app: CodeHostApp, userId: string, state: string | null): ConnectState {
  let st: ConnectState;
  try {
    st = JSON.parse(decrypt(cookie ?? "")) as ConnectState;
  } catch {
    throw new HttpError(400, "The connect session expired. Start again from Settings.");
  }
  if (st.appId !== app.id || st.userId !== userId || st.exp < Date.now() || st.state !== state) {
    throw new HttpError(400, "The connect session expired or doesn't match. Start again from Settings.");
  }
  return st;
}

/** GitHub App: verify with the user's token which installations they can access, then save one connection per installation. */
async function finishGithub(app: CodeHostApp, userId: string, st: ConnectState, params: URLSearchParams, base: string) {
  const code = params.get("code");
  if (!code) throw new HttpError(400, "Enable \"Request user authorization (OAuth) during installation\" on the GitHub App, then try again");
  const tokenRes = await fetch(`${app.webUrl}/login/oauth/access_token`, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ client_id: app.clientId, client_secret: decrypt(app.encryptedClientSecret), code, redirect_uri: callbackUrl(base, app.id) }),
    signal: AbortSignal.timeout(15_000),
  });
  const tok = (await tokenRes.json().catch(() => ({}))) as { access_token?: string; error_description?: string };
  if (!tok.access_token) throw new HttpError(400, `GitHub authorization failed: ${tok.error_description ?? tokenRes.status}`);
  const headers = { authorization: `Bearer ${tok.access_token}`, accept: "application/vnd.github+json", "user-agent": "pull-request-ai" };
  const [meRes, instRes] = await Promise.all([
    fetch(`${app.baseUrl}/user`, { headers, signal: AbortSignal.timeout(15_000) }),
    fetch(`${app.baseUrl}/user/installations?per_page=100`, { headers, signal: AbortSignal.timeout(15_000) }),
  ]);
  if (!meRes.ok || !instRes.ok) throw new HttpError(502, `GitHub returned ${meRes.status}/${instRes.status} while listing installations`);
  const me = (await meRes.json()) as { login: string };
  const { installations } = (await instRes.json()) as { installations: { id: number; app_id: number; account: { login: string } | null }[] };
  const mine = installations.filter((i) => String(i.app_id) === app.appId);
  const wanted = params.get("installation_id");
  const chosen = wanted ? mine.filter((i) => String(i.id) === wanted) : mine;
  if (!chosen.length) {
    throw new HttpError(403, wanted ? "You don't have access to that installation" : `${app.name} isn't installed on any account you can access. Install it first.`);
  }
  const db = await getDb();
  const existing = await db.select().from(schema.scmConnections).where(eq(schema.scmConnections.userId, userId));
  let created = 0;
  for (const inst of chosen) {
    if (existing.some((c) => c.appId === app.id && c.installationId === String(inst.id))) continue;
    const [row] = await db
      .insert(schema.scmConnections)
      .values({
        userId,
        provider: "github",
        authType: "github_app",
        appId: app.id,
        installationId: String(inst.id),
        name: chosen.length > 1 || !st.name ? `${st.name || app.name} · ${inst.account?.login ?? inst.id}` : st.name,
        baseUrl: app.baseUrl,
        encryptedToken: encrypt(""),
        accountLogin: me.login,
      })
      .returning({ id: schema.scmConnections.id });
    await audit(userId, "connection.create", { id: row.id, provider: "github", auth: "github_app", installation: inst.id, login: me.login });
    created++;
  }
  return created;
}

async function finishEntra(app: CodeHostApp, userId: string, st: ConnectState, params: URLSearchParams, base: string) {
  const code = params.get("code");
  if (!code) throw new HttpError(400, params.get("error_description") ?? "Microsoft didn't return an authorization code");
  if (!st.orgUrl) throw new HttpError(400, "Missing organization URL");
  const tokens = await entraTokenRequest(app, { grant_type: "authorization_code", code, redirect_uri: callbackUrl(base, app.id), code_verifier: st.verifier });
  if (!tokens.refresh_token) throw new HttpError(400, "Microsoft didn't return a refresh token (offline_access). Check the app registration.");
  const viewer = await new AzureDevOpsProvider({ bearer: async () => tokens.access_token, scope: "connect" }, st.orgUrl).getViewer();
  const db = await getDb();
  const [row] = await db
    .insert(schema.scmConnections)
    .values({
      userId,
      provider: "azure_devops",
      authType: "entra_oauth",
      appId: app.id,
      name: st.name || "Azure DevOps",
      baseUrl: st.orgUrl.replace(/\/+$/, ""),
      encryptedToken: encrypt(tokens.refresh_token),
      accountLogin: viewer.login,
    })
    .returning({ id: schema.scmConnections.id });
  primeToken(`entra:${row.id}`, tokens.access_token, tokens.expires_in);
  await audit(userId, "connection.create", { id: row.id, provider: "azure_devops", auth: "entra_oauth", login: viewer.login });
  return 1;
}

export async function finishConnect(app: CodeHostApp, userId: string, cookie: string | undefined, params: URLSearchParams, base: string) {
  if (params.get("error")) throw new HttpError(400, params.get("error_description") ?? params.get("error")!);
  const st = readState(cookie, app, userId, params.get("state"));
  return app.kind === "github_app" ? finishGithub(app, userId, st, params, base) : finishEntra(app, userId, st, params, base);
}
