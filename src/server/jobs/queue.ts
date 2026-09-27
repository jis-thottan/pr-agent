import "server-only";
import { and, asc, eq, lt, lte } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { getDb, schema } from "../db";
import type { Job } from "../db/schema";

export type JobType = Job["type"];

export const WORKER_ID = `${process.pid}-${randomUUID().slice(0, 8)}`;
/** A running job whose worker hasn't sent a heartbeat for this long is presumed dead. */
export const STALE_AFTER_MS = Number(process.env.JOB_STALE_AFTER_MS ?? 2 * 60_000);

const kickers = new Set<() => void>();
export function onEnqueue(fn: () => void) {
  kickers.add(fn);
  return () => kickers.delete(fn);
}

/** Queues a job. With a dedupeKey, a second enqueue of the same key is a no-op and returns null. */
export async function enqueue(
  type: JobType,
  payload: Record<string, unknown>,
  opts: { dedupeKey?: string; maxAttempts?: number; runAt?: Date } = {},
): Promise<string | null> {
  const db = await getDb();
  const rows = await db
    .insert(schema.jobs)
    .values({ type, payload, dedupeKey: opts.dedupeKey ?? null, maxAttempts: opts.maxAttempts ?? 3, runAt: opts.runAt ?? new Date() })
    .onConflictDoNothing({ target: schema.jobs.dedupeKey })
    .returning({ id: schema.jobs.id });
  for (const k of kickers) k();
  return rows[0]?.id ?? null;
}

/** Atomically takes the oldest due job, or returns null. Safe with several app instances on one Postgres. */
export async function claimJob(): Promise<Job | null> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(schema.jobs)
      .where(and(eq(schema.jobs.status, "queued"), lte(schema.jobs.runAt, new Date())))
      .orderBy(asc(schema.jobs.runAt))
      .limit(1)
      .for("update", { skipLocked: true });
    if (!row) return null;
    const [claimed] = await tx
      .update(schema.jobs)
      .set({ status: "running", attempts: row.attempts + 1, lockedAt: new Date(), lockedBy: WORKER_ID })
      .where(eq(schema.jobs.id, row.id))
      .returning();
    return claimed;
  });
}

export async function heartbeat(id: string) {
  const db = await getDb();
  await db.update(schema.jobs).set({ lockedAt: new Date() }).where(and(eq(schema.jobs.id, id), eq(schema.jobs.lockedBy, WORKER_ID)));
}

export async function completeJob(id: string) {
  const db = await getDb();
  await db.update(schema.jobs).set({ status: "completed", completedAt: new Date(), lockedAt: null, lastError: null }).where(eq(schema.jobs.id, id));
}

/** Requeues with exponential backoff, or fails for good. Returns true when it will be retried. */
export async function failJob(job: Job, error: string, retryable: boolean): Promise<boolean> {
  const db = await getDb();
  const retry = retryable && job.attempts < job.maxAttempts;
  await db
    .update(schema.jobs)
    .set(
      retry
        ? { status: "queued", lockedAt: null, lockedBy: null, lastError: error, runAt: new Date(Date.now() + 30_000 * 2 ** (job.attempts - 1)) }
        : { status: "failed", lockedAt: null, lastError: error, completedAt: new Date() },
    )
    .where(eq(schema.jobs.id, job.id));
  return retry;
}

/** Running jobs whose worker stopped heartbeating (crash, restart, deploy). */
export async function staleJobs(): Promise<Job[]> {
  const db = await getDb();
  return db
    .select()
    .from(schema.jobs)
    .where(and(eq(schema.jobs.status, "running"), lt(schema.jobs.lockedAt, new Date(Date.now() - STALE_AFTER_MS))));
}
