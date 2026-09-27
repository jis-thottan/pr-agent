export async function register() {
  // Background jobs (reviews, webhook-triggered reviews) run in the Node.js server process.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startWorker } = await import("./server/jobs/worker");
    startWorker();
  }
}
