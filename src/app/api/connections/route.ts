import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/server/db";
import { encrypt } from "@/server/crypto";
import { audit, HttpError, route } from "@/server/http";
import { GitHubProvider, GITHUB_DEFAULT_API } from "@/server/scm/github";

export const GET = route(async (_req, { user }) => {
  const db = await getDb();
  const rows = await db
    .select({
      id: schema.scmConnections.id,
      provider: schema.scmConnections.provider,
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

const body = z.object({
  provider: z.enum(["github"]),
  name: z.string().trim().min(1).max(100),
  baseUrl: z.string().trim().url().optional().or(z.literal("")),
  token: z.string().trim().min(10),
});

export const POST = route(async (req, { user }) => {
  const input = body.parse(await req.json());
  const baseUrl = input.baseUrl || GITHUB_DEFAULT_API;
  let login: string;
  try {
    login = (await new GitHubProvider(input.token, baseUrl).getViewer()).login;
  } catch (err) {
    throw new HttpError(400, `Could not authenticate with GitHub: ${err instanceof Error ? err.message : err}`);
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
});
