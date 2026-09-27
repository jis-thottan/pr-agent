import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb, schema } from "../db";
import type { Job } from "../db/schema";
import { claimJob, completeJob, failJob, heartbeat, onEnqueue, staleJobs } from "./queue";
import { isRetryableStatus } from "./retry";

const CONCURRENCY = Math.max(1, Number(process.env.JOB_CONCURRENCY ?? 2));
const POLL_MS = 2_000;
const HEARTBEAT_MS = 30_000;
const RECOVER_MS = Math.min(60_000, Math.max(5_000, Number(process.env.JOB_STALE_AFTER_MS ?? 60_000) / 2));

type Handler = (job: Job) => Promise<void>;

const handlers: Record<Job["type"], Handler> = {
  review: async (job) => {
    const { executeReview } = await import("../review/engine");
    const p = job.payload as { reviewId: string; options: Parameters<typeof executeReview>[1] };
    await executeReview(p.reviewId, p.options ?? {});
  },
  auto_review: async (job) => {
    const { runAutoReview } = await import("../webhooks/auto-review");
    await runAutoReview(job.payload as Parameters<typeof runAutoReview>[0]);
  },
};

const isRetryable = (err: unknown) => isRetryableStatus((err as { status?: number })?.status);

async function reviewIdOf(job: Job) {
  return job.type === "review" ? ((job.payload as { reviewId?: string }).reviewId ?? null) : null;
}

async function markReview(job: Job, willRetry: boolean, message: string) {
  const reviewId = await reviewIdOf(job);
  if (!reviewId) return;
  const db = await getDb();
  await db
    .update(schema.reviews)
    .set(
      willRetry
        ? { status: "queued", error: `Attempt ${job.attempts} failed and will be retried: ${message}`, progress: { done: 0, total: 0, current: "Waiting to retry" } }
        : { status: "failed", error: message, completedAt: new Date() },
    )
    .where(eq(schema.reviews.id, reviewId));
}

async function run(job: Job) {
  const beat = setInterval(() => void heartbeat(job.id).catch(() => {}), HEARTBEAT_MS);
  try {
    await handlers[job.type](job);
    await completeJob(job.id);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[pr-review-ai] job ${job.type} ${job.id} failed (attempt ${job.attempts}/${job.maxAttempts})`, err);
    const willRetry = await failJob(job, message, isRetryable(err));
    await markReview(job, willRetry, message);
  } finally {
    clearInterval(beat);
  }
}

/** Requeues jobs orphaned by a dead worker, and fails reviews that have no live job behind them. */
async function recover() {
  for (const job of await staleJobs()) {
    const message = "The worker running this job stopped (server restart or crash)";
    const willRetry = await failJob(job, message, true);
    await markReview(job, willRetry, message);
  }
  // Reviews left "running" by versions before the job queue, or whose job row is gone.
  const db = await getDb();
  await db
    .update(schema.reviews)
    .set({ status: "failed", error: "Interrupted. Run the review again.", completedAt: new Date() })
    .where(
      and(
        inArray(schema.reviews.status, ["queued", "running"]),
        sql`not exists (select 1 from ${schema.jobs} where ${schema.jobs.payload}->>'reviewId' = ${schema.reviews.id}::text and ${schema.jobs.status} in ('queued', 'running'))`,
      ),
    );
}

const g = globalThis as unknown as { __prWorker?: { stop: () => void } };

/** Starts the in-process worker once per server process. Several processes may share one Postgres. */
export function startWorker() {
  if (g.__prWorker || process.env.JOB_WORKER === "off") return;
  let active = 0;
  let stopped = false;
  let pumping = false;

  const pump = async () => {
    if (pumping || stopped) return;
    pumping = true;
    try {
      while (active < CONCURRENCY && !stopped) {
        const job = await claimJob();
        if (!job) break;
        active++;
        void run(job).finally(() => {
          active--;
          void pump();
        });
      }
    } catch (err) {
      console.error("[pr-review-ai] job worker poll failed", err);
    } finally {
      pumping = false;
    }
  };

  const poll = setInterval(() => void pump(), POLL_MS);
  const sweep = setInterval(() => void recover().catch((err) => console.error("[pr-review-ai] job recovery failed", err)), RECOVER_MS);
  const unsubscribe = onEnqueue(() => void pump());
  void recover().catch(() => {}).then(pump);
  g.__prWorker = {
    stop: () => {
      stopped = true;
      clearInterval(poll);
      clearInterval(sweep);
      unsubscribe();
    },
  };
  console.info(`[pr-review-ai] job worker started (concurrency ${CONCURRENCY})`);
}
