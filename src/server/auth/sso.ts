import "server-only";
import { and, count, eq } from "drizzle-orm";
import { getDb, schema } from "../db";
import { decrypt, encrypt, randomToken } from "../crypto";
import { cached } from "../cache";
import { audit, HttpError } from "../http";
import type { SsoProvider } from "../db/schema";
import { checkIdClaims, decodeJwtClaims, emailDomainAllowed, profileFromClaims, type SsoProfile } from "./oidc-claims";
import crypto from "node:crypto";

export const SSO_COOKIE = "prai_sso";
const FLOW_TTL_MS = 10 * 60_000;

type Endpoints = { authorization: string; token: string };
type FlowState = { providerId: string; state: string; nonce: string; verifier: string; exp: number; next: string };

async function oidcEndpoints(issuer: string): Promise<Endpoints> {
  return cached(`oidc:${issuer}`, 60 * 60_000, async () => {
    const res = await fetch(`${issuer.replace(/\/+$/, "")}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new HttpError(502, `OIDC discovery failed for ${issuer} (${res.status})`);
    const d = (await res.json()) as { authorization_endpoint: string; token_endpoint: string };
    return { authorization: d.authorization_endpoint, token: d.token_endpoint };
  });
}

function githubUrls(p: SsoProvider) {
  const web = p.issuer.replace(/\/+$/, "");
  const api = /^https:\/\/github\.com$/i.test(web) ? "https://api.github.com" : `${web}/api/v3`;
  return { authorization: `${web}/login/oauth/authorize`, token: `${web}/login/oauth/access_token`, api };
}

export function ssoRedirectUri(base: string, providerId: string) {
  return `${base}/api/auth/sso/${providerId}/callback`;
}

/** Builds the provider's authorization URL and the encrypted, short-lived flow cookie. */
export async function beginSso(p: SsoProvider, redirectUri: string, next: string) {
  const flow: FlowState = {
    providerId: p.id,
    state: randomToken(16),
    nonce: randomToken(16),
    verifier: randomToken(32),
    exp: Date.now() + FLOW_TTL_MS,
    next: next.startsWith("/") && !next.startsWith("//") ? next : "/",
  };
  const challenge = crypto.createHash("sha256").update(flow.verifier).digest("base64url");
  const endpoint = p.kind === "github" ? githubUrls(p).authorization : (await oidcEndpoints(p.issuer)).authorization;
  const url = new URL(endpoint);
  url.searchParams.set("client_id", p.clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", flow.state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  if (p.kind === "github") {
    url.searchParams.set("scope", "read:user user:email");
  } else {
    url.searchParams.set("scope", "openid email profile");
    url.searchParams.set("nonce", flow.nonce);
    if (p.kind === "google" || p.kind === "entra") url.searchParams.set("prompt", "select_account");
  }
  return { url: url.toString(), cookie: encrypt(JSON.stringify(flow)) };
}

async function exchangeCode(tokenUrl: string, p: SsoProvider, code: string, redirectUri: string, verifier: string) {
  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: p.clientId,
      client_secret: decrypt(p.encryptedClientSecret),
      code_verifier: verifier,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const data = (await res.json().catch(() => ({}))) as { access_token?: string; id_token?: string; error?: string; error_description?: string };
  if (!res.ok || data.error) throw new HttpError(400, `Token exchange failed: ${data.error_description ?? data.error ?? res.status}`);
  return data;
}

async function githubProfile(p: SsoProvider, accessToken: string): Promise<SsoProfile> {
  const { api } = githubUrls(p);
  const headers = { authorization: `Bearer ${accessToken}`, accept: "application/vnd.github+json", "user-agent": "pull-request-ai" };
  const [userRes, emailsRes] = await Promise.all([
    fetch(`${api}/user`, { headers, signal: AbortSignal.timeout(10_000) }),
    fetch(`${api}/user/emails`, { headers, signal: AbortSignal.timeout(10_000) }),
  ]);
  if (!userRes.ok) throw new HttpError(400, `GitHub rejected the sign-in (${userRes.status})`);
  const user = (await userRes.json()) as { id: number; login: string; name: string | null };
  const emails = emailsRes.ok ? ((await emailsRes.json()) as { email: string; primary: boolean; verified: boolean }[]) : [];
  const best = emails.find((e) => e.primary && e.verified) ?? emails.find((e) => e.verified);
  return { subject: String(user.id), email: best?.email.toLowerCase() ?? null, emailVerified: Boolean(best), name: user.name ?? user.login };
}

/** Completes the flow and returns the signed-in user id (creating or linking the account as configured). */
export async function completeSso(p: SsoProvider, params: URLSearchParams, cookie: string | undefined, redirectUri: string) {
  if (params.get("error")) throw new HttpError(400, params.get("error_description") ?? params.get("error")!);
  let flow: FlowState;
  try {
    flow = JSON.parse(decrypt(cookie ?? "")) as FlowState;
  } catch {
    throw new HttpError(400, "The sign-in session expired. Try again.");
  }
  if (flow.providerId !== p.id || flow.exp < Date.now() || flow.state !== params.get("state")) {
    throw new HttpError(400, "The sign-in session expired or doesn't match. Try again.");
  }
  const code = params.get("code");
  if (!code) throw new HttpError(400, "The provider didn't return an authorization code");

  let profile: SsoProfile;
  if (p.kind === "github") {
    const tokens = await exchangeCode(githubUrls(p).token, p, code, redirectUri, flow.verifier);
    if (!tokens.access_token) throw new HttpError(400, "GitHub didn't return an access token");
    profile = await githubProfile(p, tokens.access_token);
  } else {
    const tokens = await exchangeCode((await oidcEndpoints(p.issuer)).token, p, code, redirectUri, flow.verifier);
    if (!tokens.id_token) throw new HttpError(400, "The provider didn't return an ID token");
    const claims = decodeJwtClaims(tokens.id_token);
    try {
      checkIdClaims(claims, { issuer: p.issuer, clientId: p.clientId, nonce: flow.nonce });
    } catch (err) {
      throw new HttpError(400, (err as Error).message);
    }
    profile = profileFromClaims(p.kind, claims);
  }
  const userId = await resolveUser(p, profile);
  return { userId, next: flow.next };
}

async function resolveUser(p: SsoProvider, profile: SsoProfile): Promise<string> {
  const db = await getDb();
  if (p.allowedDomains.length && !profile.emailVerified) {
    throw new HttpError(403, "The provider didn't supply a verified email address, so the allowed domains can't be checked");
  }
  if (!emailDomainAllowed(profile.emailVerified ? profile.email : null, p.allowedDomains)) {
    throw new HttpError(403, `Sign-in is limited to ${p.allowedDomains.join(", ")} accounts`);
  }
  const [identity] = await db
    .select({ userId: schema.userIdentities.userId, disabledAt: schema.users.disabledAt })
    .from(schema.userIdentities)
    .innerJoin(schema.users, eq(schema.users.id, schema.userIdentities.userId))
    .where(and(eq(schema.userIdentities.providerId, p.id), eq(schema.userIdentities.subject, profile.subject)))
    .limit(1);
  if (identity) {
    if (identity.disabledAt) throw new HttpError(403, "This account has been deactivated");
    return identity.userId;
  }
  if (!profile.email || !profile.emailVerified) {
    throw new HttpError(403, "The provider didn't supply a verified email address, so the account can't be matched");
  }

  const [existing] = await db.select().from(schema.users).where(eq(schema.users.email, profile.email)).limit(1);
  if (existing) {
    if (existing.disabledAt) throw new HttpError(403, "This account has been deactivated");
    await db.insert(schema.userIdentities).values({ userId: existing.id, providerId: p.id, subject: profile.subject, email: profile.email });
    await audit(existing.id, "sso.link", { provider: p.name, email: profile.email });
    return existing.id;
  }
  if (!p.autoCreateUsers) throw new HttpError(403, `No account exists for ${profile.email}. Ask an admin to add you.`);

  const [{ n }] = await db.select({ n: count() }).from(schema.users);
  const [user] = await db
    .insert(schema.users)
    .values({ email: profile.email, name: profile.name || profile.email.split("@")[0], passwordHash: null, role: n === 0 ? "admin" : p.defaultRole })
    .returning();
  await db.insert(schema.userIdentities).values({ userId: user.id, providerId: p.id, subject: profile.subject, email: profile.email });
  await audit(user.id, "user.register", { via: p.name, role: user.role });
  return user.id;
}
