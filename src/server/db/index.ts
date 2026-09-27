import "server-only";
import path from "node:path";
import fs from "node:fs";
import { drizzle as drizzlePg } from "drizzle-orm/postgres-js";
import { migrate as migratePg } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import * as schema from "./schema";

export type Db = ReturnType<typeof drizzlePg<typeof schema>>;

const globalForDb = globalThis as unknown as { __prDb?: Promise<Db> };

const migrationsFolder = path.join(process.cwd(), "drizzle");

async function init(): Promise<Db> {
  const url = process.env.DATABASE_URL;
  if (url) {
    const client = postgres(url, { max: 10 });
    const db = drizzlePg(client, { schema });
    await migratePg(db, { migrationsFolder });
    return db;
  }

  // No DATABASE_URL: use embedded PGlite (Postgres compiled to WASM) persisted under DATA_DIR.
  // Good for single-user / evaluation setups; use real Postgres for teams.
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle: drizzleLite } = await import("drizzle-orm/pglite");
  const { migrate: migrateLite } = await import("drizzle-orm/pglite/migrator");
  const dir = path.join(process.env.DATA_DIR ?? path.join(process.cwd(), "data"), "pglite");
  fs.mkdirSync(dir, { recursive: true });
  const client = new PGlite(dir);
  const db = drizzleLite(client, { schema });
  await migrateLite(db, { migrationsFolder });
  // The query-builder API is identical across drivers.
  return db as unknown as Db;
}

// Interrupted reviews are recovered by the job worker (src/server/jobs/worker.ts), not here.
export function getDb(): Promise<Db> {
  if (!globalForDb.__prDb) {
    globalForDb.__prDb = init().catch((err) => {
      globalForDb.__prDb = undefined;
      throw err;
    });
  }
  return globalForDb.__prDb;
}

export { schema };
