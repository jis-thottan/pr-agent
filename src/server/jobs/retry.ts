/** Retry network errors (no status), timeouts, 429s and 5xx; any other status (bad config, budget) is final. */
export function isRetryableStatus(status: number | undefined) {
  if (typeof status !== "number") return true;
  return status === 408 || status === 429 || status >= 500;
}
