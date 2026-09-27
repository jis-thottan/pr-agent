import "server-only";
import crypto from "node:crypto";
import { z } from "zod";

export const codeHostAppInput = z
  .discriminatedUnion("kind", [
    z.object({
      kind: z.literal("github_app"),
      name: z.string().trim().min(1).max(100),
      baseUrl: z.string().trim().url().default("https://api.github.com"),
      webUrl: z.string().trim().url().default("https://github.com"),
      appId: z.string().trim().regex(/^\d+$/, "App ID is a number"),
      slug: z.string().trim().regex(/^[a-z0-9-]+$/i, "Use the app's URL name, e.g. my-review-bot"),
      clientId: z.string().trim().min(1),
      clientSecret: z.string().trim().min(1).optional(),
      privateKey: z.string().trim().optional(),
    }),
    z.object({
      kind: z.literal("entra_devops"),
      name: z.string().trim().min(1).max(100),
      // Tenant ID or primary domain.
      baseUrl: z.string().trim().min(3),
      clientId: z.string().trim().min(1),
      clientSecret: z.string().trim().min(1).optional(),
    }),
  ])
  .superRefine((v, ctx) => {
    if (v.kind === "github_app" && v.privateKey) {
      try {
        crypto.createPrivateKey(v.privateKey);
      } catch {
        ctx.addIssue({ code: "custom", path: ["privateKey"], message: "Not a valid PEM private key" });
      }
    }
  });

export type CodeHostAppInput = z.infer<typeof codeHostAppInput>;
