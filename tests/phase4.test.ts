import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { can } from "../src/lib/permissions.ts";
import { checkIdClaims, decodeJwtClaims, emailDomainAllowed, entraIssuer, profileFromClaims } from "../src/server/auth/oidc-claims.ts";
import { githubAppJwt } from "../src/server/scm/github-jwt.ts";
import { aggregate, median } from "../src/server/dashboard/metrics.ts";

test("role permissions", () => {
  assert.ok(can("viewer", "read"));
  assert.ok(!can("viewer", "review") && !can("viewer", "post"));
  assert.ok(can("reviewer", "review") && can("reviewer", "post") && !can("reviewer", "dashboard"));
  assert.ok(can("lead", "dashboard") && can("lead", "audit") && can("lead", "shareProfiles") && !can("lead", "manageUsers"));
  assert.ok(can("admin", "manageUsers") && can("admin", "manageProviders"));
  assert.ok(!can(null, "read") && !can("intruder", "read"));
});

const jwt = (claims: object) => `e30.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.sig`;

test("ID token claims: issuer, audience, expiry and nonce are enforced", () => {
  const now = 1_800_000_000;
  const good = { iss: "https://login.microsoftonline.com/t1/v2.0", aud: "client-1", exp: now + 600, nonce: "n1", sub: "s1" };
  const expected = { issuer: "https://login.microsoftonline.com/t1/v2.0/", clientId: "client-1", nonce: "n1", now };
  assert.doesNotThrow(() => checkIdClaims(decodeJwtClaims(jwt(good)), expected));
  assert.throws(() => checkIdClaims({ ...good, iss: "https://evil.example" }, expected), /issuer/);
  assert.throws(() => checkIdClaims({ ...good, aud: ["other"] }, expected), /different client/);
  assert.throws(() => checkIdClaims({ ...good, exp: now - 3600 }, expected), /expired/);
  assert.throws(() => checkIdClaims({ ...good, nonce: "replayed" }, expected), /nonce/);
});

test("profiles from claims and domain policy", () => {
  assert.deepEqual(profileFromClaims("entra", { sub: "s", preferred_username: "Ada@Contoso.com", name: "Ada" }), { subject: "s", email: "ada@contoso.com", emailVerified: true, name: "Ada" });
  assert.equal(profileFromClaims("google", { sub: "s", email: "a@x.com", email_verified: false }).emailVerified, false);
  assert.equal(profileFromClaims("oidc", { sub: "s", email: "a@x.com", email_verified: "true" }).emailVerified, true);
  assert.ok(emailDomainAllowed("a@contoso.com", ["@Contoso.com"]));
  assert.ok(!emailDomainAllowed("a@evil.com", ["contoso.com"]));
  assert.ok(!emailDomainAllowed(null, ["contoso.com"]));
  assert.ok(emailDomainAllowed(null, []));
  assert.equal(entraIssuer("contoso.onmicrosoft.com"), "https://login.microsoftonline.com/contoso.onmicrosoft.com/v2.0");
  assert.throws(() => entraIssuer("common"));
});

test("GitHub App JWT is RS256-signed with iss = app id", () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const token = githubAppJwt("12345", privateKey.export({ type: "pkcs1", format: "pem" }).toString(), 1_800_000_000);
  const [h, p, sig] = token.split(".");
  assert.deepEqual(JSON.parse(Buffer.from(h, "base64url").toString()), { alg: "RS256", typ: "JWT" });
  assert.deepEqual(JSON.parse(Buffer.from(p, "base64url").toString()), { iat: 1_800_000_000 - 60, exp: 1_800_000_000 + 540, iss: "12345" });
  assert.ok(crypto.createVerify("RSA-SHA256").update(`${h}.${p}`).verify(publicKey, Buffer.from(sig, "base64url")));
});

test("dashboard aggregation", () => {
  assert.equal(median([]), null);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 2, 3]), 2.5);
  const since = new Date("2026-09-01T00:00:00Z");
  const until = new Date("2026-09-03T12:00:00Z");
  const r = (id: string, userId: string, day: string, extra: object = {}) => ({
    id, userId, owner: "acme", repo: "web", trigger: "manual" as const, status: "completed", baseReviewId: null, costUsd: 0.5,
    createdAt: new Date(`${day}T10:00:00Z`), completedAt: new Date(`${day}T10:05:00Z`), postedAt: null as Date | null, ...extra,
  });
  const reviews = [
    r("a", "u1", "2026-09-01", { postedAt: new Date("2026-09-01T10:35:00Z") }),
    r("b", "u1", "2026-09-03", { trigger: "webhook", baseReviewId: "a" }),
    r("c", "u2", "2026-09-03", { status: "failed", completedAt: null }),
  ];
  const findings = [
    { reviewId: "a", severity: "critical", category: "security", state: "posted", n: 1 },
    { reviewId: "a", severity: "minor", category: "style", state: "dismissed", n: 3 },
    { reviewId: "b", severity: "major", category: "bug", state: "pending", n: 2 },
  ];
  const out = aggregate(reviews, findings, new Map([["u1", "Ada"], ["u2", "Bo"]]), since, until);
  assert.equal(out.totals.reviews, 3);
  assert.equal(out.totals.automatic, 1);
  assert.equal(out.totals.incremental, 1);
  assert.equal(out.totals.failed, 1);
  assert.equal(out.totals.posted, 1);
  assert.equal(out.totals.findings, 6);
  assert.equal(out.totals.acceptanceRate, 0.25, "1 accepted of 4 decided; pending doesn't count");
  assert.equal(out.totals.medianMinutesToPost, 30);
  assert.deepEqual(out.daily.map((d) => [d.day, d.reviews, d.posted]), [["2026-09-01", 1, 1], ["2026-09-02", 0, 0], ["2026-09-03", 2, 0]]);
  assert.deepEqual(out.reviewers.map((x) => [x.name, x.reviews, x.critical]), [["Ada", 2, 1], ["Bo", 1, 0]]);
  assert.equal(out.repos[0].costUsd, 1.5);
});
