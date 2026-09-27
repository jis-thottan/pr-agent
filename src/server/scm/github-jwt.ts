import crypto from "node:crypto";

/** RS256 JWT a GitHub App uses to authenticate as itself (valid for up to 10 minutes). */
export function githubAppJwt(appId: string, privateKeyPem: string, now = Math.floor(Date.now() / 1000)) {
  const enc = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const unsigned = `${enc({ alg: "RS256", typ: "JWT" })}.${enc({ iat: now - 60, exp: now + 540, iss: appId })}`;
  const signature = crypto.createSign("RSA-SHA256").update(unsigned).sign(privateKeyPem).toString("base64url");
  return `${unsigned}.${signature}`;
}
