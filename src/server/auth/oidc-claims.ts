// ID-token claim checks and sign-in policy, kept free of I/O so they can be unit tested.
//
// The ID token is received directly from the provider's token endpoint over TLS (authorization
// code flow with a client secret), so per OIDC Core §3.1.3.7 TLS server validation stands in for
// signature validation; iss, aud, exp and nonce are still checked here.

export interface IdClaims {
  iss?: string;
  sub?: string;
  aud?: string | string[];
  exp?: number;
  nonce?: string;
  email?: string;
  email_verified?: boolean | string;
  preferred_username?: string;
  upn?: string;
  name?: string;
  tid?: string;
}

export function decodeJwtClaims(jwt: string): IdClaims {
  const part = jwt.split(".")[1];
  if (!part) throw new Error("The ID token is malformed");
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as IdClaims;
}

export function checkIdClaims(c: IdClaims, expected: { issuer: string; clientId: string; nonce: string; now?: number }) {
  const now = expected.now ?? Math.floor(Date.now() / 1000);
  const norm = (s: string) => s.replace(/\/+$/, "");
  if (!c.iss || norm(c.iss) !== norm(expected.issuer)) throw new Error(`Unexpected token issuer ${c.iss}`);
  const aud = Array.isArray(c.aud) ? c.aud : [c.aud];
  if (!aud.includes(expected.clientId)) throw new Error("The ID token was issued to a different client");
  if (!c.exp || c.exp < now - 60) throw new Error("The ID token has expired");
  if (c.nonce !== expected.nonce) throw new Error("The sign-in response doesn't match this browser session (nonce)");
  if (!c.sub) throw new Error("The ID token has no subject");
}

export interface SsoProfile {
  subject: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
}

/**
 * Normalises claims per provider. Entra ID (single-tenant issuer) is trusted for its UPN/email;
 * Google and generic OIDC must assert email_verified.
 */
export function profileFromClaims(kind: "entra" | "google" | "oidc", c: IdClaims): SsoProfile {
  const verified = c.email_verified === true || c.email_verified === "true";
  if (kind === "entra") {
    const email = (c.email ?? c.preferred_username ?? c.upn ?? "").toLowerCase() || null;
    return { subject: c.sub!, email: email?.includes("@") ? email : null, emailVerified: Boolean(email?.includes("@")), name: c.name ?? null };
  }
  return { subject: c.sub!, email: c.email?.toLowerCase() ?? null, emailVerified: verified, name: c.name ?? null };
}

export function emailDomainAllowed(email: string | null, allowedDomains: string[]) {
  if (!allowedDomains.length) return true;
  const domain = email?.split("@")[1]?.toLowerCase();
  return Boolean(domain && allowedDomains.some((d) => d.toLowerCase().replace(/^@/, "") === domain));
}

/** Entra tenant ID or verified domain → the v2.0 issuer. "common"/"organizations" are refused (issuer varies). */
export function entraIssuer(tenant: string) {
  const t = tenant.trim();
  if (!t || ["common", "organizations", "consumers"].includes(t.toLowerCase())) {
    throw new Error("Use your tenant ID (or primary domain), not common/organizations");
  }
  return `https://login.microsoftonline.com/${encodeURIComponent(t)}/v2.0`;
}
