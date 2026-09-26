import "server-only";

const store = new Map<string, { value: unknown; expires: number }>();

/** Small in-memory TTL cache for slow, read-only upstream listings. */
export async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>, refresh = false): Promise<T> {
  const hit = store.get(key);
  if (!refresh && hit && hit.expires > Date.now()) return hit.value as T;
  const value = await fn();
  store.set(key, { value, expires: Date.now() + ttlMs });
  return value;
}
