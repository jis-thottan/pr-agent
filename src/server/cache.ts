import "server-only";

const store = new Map<string, { value: Promise<unknown>; expires: number }>();

/**
 * Small in-memory TTL cache for slow, read-only upstream calls.
 * Concurrent callers share one in-flight request; failures are not cached.
 */
export async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>, refresh = false): Promise<T> {
  const hit = store.get(key);
  if (!refresh && hit && hit.expires > Date.now()) return hit.value as Promise<T>;
  const value = fn();
  store.set(key, { value, expires: Date.now() + ttlMs });
  value.catch(() => {
    if (store.get(key)?.value === value) store.delete(key);
  });
  if (store.size > 500) {
    const now = Date.now();
    for (const [k, v] of store) if (v.expires <= now) store.delete(k);
  }
  return value;
}
