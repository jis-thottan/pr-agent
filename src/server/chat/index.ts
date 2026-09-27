import "server-only";
import { and, asc, desc, eq, ne } from "drizzle-orm";
import { getDb, schema } from "../db";
import { HttpError } from "../http";
import { aiClientFor } from "../ai";
import type { ChatMessage } from "../ai/types";
import type { ScmConnection } from "../db/schema";
import { providerFor } from "../scm";
import { redactSecrets } from "../review/redact";
import { checkBudget, metered } from "../usage";
import { buildChatContext, CHAT_SYSTEM_PROMPT } from "./context";

const CHARS_PER_TOKEN = 3.5;
const HISTORY_LIMIT = 30;
const MAX_FOCUS_FILE_CHARS = 60_000;

export async function listChat(userId: string, connectionId: string, prKey: string) {
  const db = await getDb();
  return db
    .select()
    .from(schema.chatMessages)
    .where(and(eq(schema.chatMessages.userId, userId), eq(schema.chatMessages.connectionId, connectionId), eq(schema.chatMessages.prKey, prKey)))
    .orderBy(asc(schema.chatMessages.createdAt));
}

export async function askAboutPr(args: {
  userId: string;
  conn: ScmConnection;
  owner: string;
  repo: string;
  number: number;
  prKey: string;
  providerId: string;
  question: string;
  focusPath?: string | null;
}) {
  const db = await getDb();
  const [provider] = await db.select().from(schema.aiProviders).where(eq(schema.aiProviders.id, args.providerId)).limit(1);
  if (!provider) throw new HttpError(404, "AI provider not found");
  await checkBudget(args.userId, provider);

  const scm = providerFor(args.conn);
  const [pr, files, history, [latest]] = await Promise.all([
    scm.getPull(args.owner, args.repo, args.number),
    scm.getFiles(args.owner, args.repo, args.number),
    listChat(args.userId, args.conn.id, args.prKey),
    db
      .select({ id: schema.reviews.id })
      .from(schema.reviews)
      .where(
        and(
          eq(schema.reviews.userId, args.userId),
          eq(schema.reviews.connectionId, args.conn.id),
          eq(schema.reviews.owner, args.owner),
          eq(schema.reviews.repo, args.repo),
          eq(schema.reviews.prNumber, args.number),
          ne(schema.reviews.status, "failed"),
        ),
      )
      .orderBy(desc(schema.reviews.createdAt))
      .limit(1),
  ]);
  const findings = latest ? await db.select().from(schema.findings).where(eq(schema.findings.reviewId, latest.id)) : [];
  const focusFile = args.focusPath ? files.find((f) => f.path === args.focusPath && f.status !== "removed") : undefined;
  const focusContent = focusFile
    ? await scm.getFileContent(args.owner, args.repo, focusFile.path, pr.headSha).catch(() => null)
    : null;

  const totalChars = provider.maxContextTokens * CHARS_PER_TOKEN;
  const outputReserve = Math.min(4096, provider.maxContextTokens * 0.25) * CHARS_PER_TOKEN;
  const room = totalChars - outputReserve - CHAT_SYSTEM_PROMPT.length - args.question.length - 500;

  // Keep the most recent turns that fit in a quarter of the room; the PR context gets the rest.
  const recent: ChatMessage[] = [];
  let historyChars = 0;
  for (const m of history.slice(-HISTORY_LIMIT).reverse()) {
    if (historyChars + m.content.length > room * 0.25) break;
    recent.unshift({ role: m.role, content: m.content });
    historyChars += m.content.length;
  }

  const context = buildChatContext({
    title: pr.title,
    description: pr.body,
    files,
    findings,
    question: args.question,
    focusPath: focusFile?.path ?? null,
    focusContent: focusContent && focusContent.length <= MAX_FOCUS_FILE_CHARS ? focusContent : null,
    budget: Math.max(4000, room - historyChars),
  });

  const redact = (s: string) => (provider.isLocal ? s : redactSecrets(s).text);
  const ai = metered(aiClientFor(provider), { userId: args.userId, provider, kind: "chat" });
  const res = await ai.chat(
    [
      { role: "system", content: `${CHAT_SYSTEM_PROMPT}\n\n# Pull request context\n\n${redact(context.text)}` },
      ...recent.map((m) => ({ ...m, content: redact(m.content) })),
      { role: "user", content: redact(args.question) },
    ],
    { maxTokens: 4096 },
  );
  const answer = res.content.replace(/<think>[\s\S]*?<\/think>/g, "").trim() || "_The model returned an empty answer._";

  const [q, a] = await db
    .insert(schema.chatMessages)
    .values([
      { userId: args.userId, connectionId: args.conn.id, prKey: args.prKey, role: "user", content: args.question, headSha: pr.headSha },
      { userId: args.userId, connectionId: args.conn.id, prKey: args.prKey, role: "assistant", content: answer, model: provider.model, headSha: pr.headSha },
    ])
    .returning();
  return { messages: [q, a], omitted: context.omitted };
}
