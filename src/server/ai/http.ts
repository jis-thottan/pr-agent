import "server-only";

export const AI_TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS ?? 300_000);

export class AiRequestError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Sleeps before retrying a 429/5xx; returns false when retries are exhausted. */
export async function backoff(res: Response, attempt: number, maxAttempts = 2): Promise<boolean> {
  if (!(res.status === 429 || res.status >= 500) || attempt >= maxAttempts) return false;
  const retryAfter = Number(res.headers.get("retry-after")) || 2 ** attempt * 2;
  await new Promise((r) => setTimeout(r, Math.min(retryAfter, 30) * 1000));
  return true;
}

export async function failure(res: Response, label: string): Promise<AiRequestError> {
  const text = await res.text().catch(() => "");
  return new AiRequestError(res.status, `${label} returned ${res.status}: ${text.slice(0, 500)}`);
}
