import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  real,
  boolean,
  jsonb,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  role: text("role", { enum: ["admin", "reviewer"] }).notNull().default("reviewer"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable("sessions", {
  // SHA-256 of the cookie token; the raw token is never stored.
  id: text("id").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export const scmConnections = pgTable(
  "scm_connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider", { enum: ["github", "azure_devops"] }).notNull(),
    name: text("name").notNull(),
    baseUrl: text("base_url").notNull(),
    encryptedToken: text("encrypted_token").notNull(),
    accountLogin: text("account_login"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("scm_connections_user_idx").on(t.userId)],
);

export const AI_PROVIDER_TYPES = ["openai_compatible", "azure_openai", "anthropic", "gemini"] as const;

export const aiProviders = pgTable("ai_providers", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  type: text("type", { enum: AI_PROVIDER_TYPES }).notNull().default("openai_compatible"),
  baseUrl: text("base_url").notNull(),
  // Azure OpenAI only: the api-version query parameter.
  apiVersion: text("api_version"),
  encryptedApiKey: text("encrypted_api_key"),
  model: text("model").notNull(),
  temperature: real("temperature").notNull().default(0.1),
  maxContextTokens: integer("max_context_tokens").notNull().default(16000),
  jsonMode: boolean("json_mode").notNull().default(true),
  isLocal: boolean("is_local").notNull().default(false),
  isDefault: boolean("is_default").notNull().default(false),
  // USD per million tokens; null means "not priced" (e.g. a local model) and costs nothing.
  inputCostPerMTok: real("input_cost_per_mtok"),
  outputCostPerMTok: real("output_cost_per_mtok"),
  // Month-to-date spend cap across all users; null = unlimited.
  monthlyBudgetUsd: real("monthly_budget_usd"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ReviewProgress = { done: number; total: number; current?: string };

export const SEVERITIES = ["critical", "major", "minor", "nit"] as const;
export const CATEGORIES = [
  "bug",
  "security",
  "performance",
  "maintainability",
  "style",
  "tests",
  "docs",
] as const;
export type Severity = (typeof SEVERITIES)[number];
export type Category = (typeof CATEGORIES)[number];

/** Saved run settings: a reviewer's own, or shared with everyone on the server. */
export const reviewProfiles = pgTable(
  "review_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    shared: boolean("shared").notNull().default(false),
    providerId: uuid("provider_id").references(() => aiProviders.id, { onDelete: "set null" }),
    instructions: text("instructions"),
    extraIgnore: jsonb("extra_ignore").$type<string[]>().notNull().default([]),
    fullFileContext: boolean("full_file_context").notNull().default(true),
    minSeverity: text("min_severity", { enum: SEVERITIES }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("review_profiles_user_idx").on(t.userId)],
);

/** What a review actually applied from the repository's .pr-review.yml (for the Overview tab). */
export type AppliedRepoRules = {
  path: string;
  ref: string;
  instructions: string | null;
  ignore: string[];
  minSeverity: Severity | null;
  pathInstructions: { path: string; instructions: string }[];
  warnings: string[];
};

export const REVIEW_STATUSES = ["queued", "running", "completed", "failed"] as const;

export const reviews = pgTable(
  "reviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => scmConnections.id, { onDelete: "cascade" }),
    owner: text("owner").notNull(),
    repo: text("repo").notNull(),
    prNumber: integer("pr_number").notNull(),
    headSha: text("head_sha").notNull(),
    baseSha: text("base_sha").notNull(),
    providerId: uuid("provider_id").references(() => aiProviders.id, { onDelete: "set null" }),
    model: text("model").notNull(),
    instructions: text("instructions"),
    profileId: uuid("profile_id").references(() => reviewProfiles.id, { onDelete: "set null" }),
    minSeverity: text("min_severity", { enum: SEVERITIES }),
    repoRules: jsonb("repo_rules").$type<AppliedRepoRules>(),
    status: text("status", { enum: REVIEW_STATUSES }).notNull().default("running"),
    trigger: text("trigger", { enum: ["manual", "webhook"] }).notNull().default("manual"),
    autoRuleId: uuid("auto_rule_id"),
    // Incremental reviews: the earlier review whose findings on unchanged files were carried forward.
    baseReviewId: uuid("base_review_id"),
    // Blob SHA of every PR file at review time, so a later review can skip unchanged files.
    fileShas: jsonb("file_shas").$type<Record<string, string>>().notNull().default({}),
    unchangedFiles: jsonb("unchanged_files").$type<string[]>().notNull().default([]),
    costUsd: real("cost_usd").notNull().default(0),
    progress: jsonb("progress").$type<ReviewProgress>().notNull().default({ done: 0, total: 0 }),
    summary: text("summary"),
    riskLevel: text("risk_level", { enum: ["low", "medium", "high"] }),
    verdict: text("verdict", { enum: ["approve", "comment", "request_changes"] }),
    error: text("error"),
    promptTokens: integer("prompt_tokens").notNull().default(0),
    completionTokens: integer("completion_tokens").notNull().default(0),
    skippedFiles: jsonb("skipped_files").$type<string[]>().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    postedAt: timestamp("posted_at", { withTimezone: true }),
    postedUrl: text("posted_url"),
  },
  (t) => [
    index("reviews_pr_idx").on(t.connectionId, t.owner, t.repo, t.prNumber),
    index("reviews_user_trigger_idx").on(t.userId, t.trigger, t.createdAt),
  ],
);

export const findings = pgTable(
  "findings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reviewId: uuid("review_id")
      .notNull()
      .references(() => reviews.id, { onDelete: "cascade" }),
    source: text("source", { enum: ["ai", "human"] }).notNull(),
    path: text("path").notNull(),
    line: integer("line"),
    endLine: integer("end_line"),
    // Whether `line` is a commentable line in the PR diff (GitHub rejects inline comments elsewhere).
    inDiff: boolean("in_diff").notNull().default(false),
    severity: text("severity", { enum: SEVERITIES }).notNull(),
    category: text("category", { enum: CATEGORIES }).notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    suggestion: text("suggestion"),
    // Set when an incremental review copied this finding from an earlier review of an unchanged file.
    carriedFromId: uuid("carried_from_id"),
    state: text("state", { enum: ["pending", "accepted", "dismissed", "posted"] })
      .notNull()
      .default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("findings_review_idx").on(t.reviewId)],
);

export const viewedFiles = pgTable(
  "viewed_files",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => scmConnections.id, { onDelete: "cascade" }),
    prKey: text("pr_key").notNull(),
    path: text("path").notNull(),
    // Blob SHA at the time it was marked viewed; a new push changes it and un-views the file.
    sha: text("sha").notNull(),
  },
  (t) => [uniqueIndex("viewed_files_uq").on(t.userId, t.connectionId, t.prKey, t.path)],
);

export const auditLog = pgTable("audit_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  action: text("action").notNull(),
  details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Durable background work (reviews, webhook-triggered reviews), claimed with FOR UPDATE SKIP LOCKED. */
export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    type: text("type", { enum: ["review", "auto_review"] }).notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    status: text("status", { enum: ["queued", "running", "completed", "failed"] }).notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    runAt: timestamp("run_at", { withTimezone: true }).notNull().defaultNow(),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lockedBy: text("locked_by"),
    lastError: text("last_error"),
    // Webhook deliveries are retried by the host; this makes enqueueing idempotent.
    dedupeKey: text("dedupe_key"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [index("jobs_claim_idx").on(t.status, t.runAt), uniqueIndex("jobs_dedupe_uq").on(t.dedupeKey)],
);

/** Webhook-triggered draft reviews for one repository, owned by the user whose connection runs them. */
export const autoReviewRules = pgTable(
  "auto_review_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => scmConnections.id, { onDelete: "cascade" }),
    owner: text("owner").notNull(),
    repo: text("repo").notNull(),
    providerId: uuid("provider_id").references(() => aiProviders.id, { onDelete: "set null" }),
    profileId: uuid("profile_id").references(() => reviewProfiles.id, { onDelete: "set null" }),
    encryptedSecret: text("encrypted_secret").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    onOpen: boolean("on_open").notNull().default(true),
    onPush: boolean("on_push").notNull().default(true),
    skipDrafts: boolean("skip_drafts").notNull().default(true),
    incremental: boolean("incremental").notNull().default(true),
    lastDeliveryAt: timestamp("last_delivery_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("auto_review_rules_uq").on(t.userId, t.connectionId, t.owner, t.repo)],
);

/** One row per model call, for cost reporting and budget enforcement. */
export const aiUsage = pgTable(
  "ai_usage",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    providerId: uuid("provider_id").references(() => aiProviders.id, { onDelete: "set null" }),
    reviewId: uuid("review_id").references(() => reviews.id, { onDelete: "set null" }),
    kind: text("kind", { enum: ["review", "chat", "test"] }).notNull(),
    model: text("model").notNull(),
    promptTokens: integer("prompt_tokens").notNull().default(0),
    completionTokens: integer("completion_tokens").notNull().default(0),
    costUsd: real("cost_usd").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ai_usage_created_idx").on(t.createdAt), index("ai_usage_user_idx").on(t.userId, t.createdAt)],
);

export const chatMessages = pgTable(
  "chat_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => scmConnections.id, { onDelete: "cascade" }),
    prKey: text("pr_key").notNull(),
    role: text("role", { enum: ["user", "assistant"] }).notNull(),
    content: text("content").notNull(),
    model: text("model"),
    // The head commit the answer was based on.
    headSha: text("head_sha"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("chat_messages_pr_idx").on(t.userId, t.connectionId, t.prKey, t.createdAt)],
);

/** Server-wide settings edited by admins, as key → JSON value. */
export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<unknown>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type User = typeof users.$inferSelect;
export type ScmConnection = typeof scmConnections.$inferSelect;
export type AiProvider = typeof aiProviders.$inferSelect;
export type Review = typeof reviews.$inferSelect;
export type Finding = typeof findings.$inferSelect;
export type ReviewProfile = typeof reviewProfiles.$inferSelect;
export type Job = typeof jobs.$inferSelect;
export type AutoReviewRule = typeof autoReviewRules.$inferSelect;
