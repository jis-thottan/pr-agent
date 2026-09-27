import "server-only";
import { z } from "zod";
import { ROLES } from "../db/schema";
import { entraIssuer } from "./oidc-claims";

export const ssoInput = z
  .object({
    kind: z.enum(["entra", "google", "oidc", "github"]),
    name: z.string().trim().min(1).max(100),
    // entra: tenant ID or domain; oidc: issuer URL; github: web URL (defaults to github.com); google: ignored.
    issuer: z.string().trim().max(500).default(""),
    clientId: z.string().trim().min(1).max(500),
    // Omit on update to keep the stored secret.
    clientSecret: z.string().trim().min(1).max(2000).optional(),
    enabled: z.boolean().default(true),
    allowedDomains: z.array(z.string().trim().toLowerCase().min(3).max(253)).max(50).default([]),
    autoCreateUsers: z.boolean().default(true),
    defaultRole: z.enum(ROLES).default("reviewer"),
  })
  .transform((v, ctx) => {
    let issuer = v.issuer;
    try {
      if (v.kind === "entra") issuer = entraIssuer(v.issuer);
      else if (v.kind === "google") issuer = "https://accounts.google.com";
      else if (v.kind === "github") issuer = (v.issuer || "https://github.com").replace(/\/+$/, "");
      else issuer = new URL(v.issuer).toString().replace(/\/+$/, "");
    } catch (err) {
      ctx.addIssue({ code: "custom", path: ["issuer"], message: err instanceof Error ? err.message : "Invalid issuer" });
      return z.NEVER;
    }
    return { ...v, issuer, allowedDomains: v.allowedDomains.map((d) => d.replace(/^@/, "")) };
  });

/** The tenant or URL as the admin typed it, for editing. */
export function issuerForForm(kind: string, issuer: string) {
  if (kind === "entra") return decodeURIComponent(issuer.replace(/^https:\/\/login\.microsoftonline\.com\//, "").replace(/\/v2\.0$/, ""));
  return kind === "google" ? "" : issuer;
}
