import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/server/db";
import { encrypt } from "@/server/crypto";
import { audit, HttpError, route } from "@/server/http";
import { providerFor } from "@/server/scm";
import { GITHUB_DEFAULT_API } from "@/server/scm/github";

export const GET = route(async (_req, { user }) => {
  const db = await getDb();
  const rows = await db
    .select({
      id: schema.scmConnections.id,
      provider: schema.scmConnections.provider,
      authType: schema.scmConnections.authType,
      name: schema.scmConnections.name,
      baseUrl: schema.scmConnections.baseUrl,
      accountLogin: schema.scmConnections.accountLogin,
      createdAt: schema.scmConnections.createdAt,
    })
    .from(schema.scmConnections)
    .where(eq(schema.scmConnections.userId, user.id))
    .orderBy(desc(schema.scmConnections.createdAt));
  return { connections: rows };
});

const body = z.discriminatedUnion("provider", [
  z.object({
    provider: z.literal("github"),
    name: z.string().trim().min(1).max(100),
    baseUrl: z.string().trim().url().optional().or(z.literal("")),
    token: z.string().trim().min(10),
  }),
  z.object({
    provider: z.literal("azure_devops"),
    name: z.string().trim().min(1).max(100),
    // https://dev.azure.com/{org}, https://{org}.visualstudio.com or https://server/tfs/{collection}
    baseUrl: z.string().trim().url(),
    token: z.string().trim().min(10),
  }),
]);

const HOST_LABEL = { github: "GitHub", azure_devops: "Azure DevOps" } as const;

export const POST = route(async (req, { user }) => {
  const input = body.parse(await req.json());
  const baseUrl = (input.baseUrl || GITHUB_DEFAULT_API).replace(/\/+$/, "");
  let login: string;
  try {
    login = (await providerFor({ provider: input.provider, baseUrl, encryptedToken: encrypt(input.token) }).getViewer()).login;
  } catch (err) {
    throw new HttpError(400, `Could not authenticate with ${HOST_LABEL[input.provider]}: ${err instanceof Error ? err.message : err}`);
  }
  const db = await getDb();
  const [row] = await db
    .insert(schema.scmConnections)
    .values({
      userId: user.id,
      provider: input.provider,
      name: input.name,
      baseUrl,
      encryptedToken: encrypt(input.token),
      accountLogin: login,
    })
    .returning({ id: schema.scmConnections.id });
  await audit(user.id, "connection.create", { id: row.id, provider: input.provider, login });
  return { id: row.id, accountLogin: login };
}, { perm: "read" });
