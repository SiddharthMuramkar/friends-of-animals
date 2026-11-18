import "server-only";

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { env } from "@/env";

import * as schema from "./schema";

// The connection opens lazily, on first use, so importing this module needs
// no database. `next build` imports it without one.
function createDb() {
  const client = postgres(env().DATABASE_URL, {
    // PgBouncer in transaction mode (our only public database endpoint)
    // doesn't support prepared statements.
    prepare: false,
    // Each Vercel Function instance keeps its own small pool.
    max: 5,
  });
  return drizzle(client, { schema });
}

export type Db = ReturnType<typeof createDb>;

let instance: Db | undefined;

function getDb() {
  instance ??= createDb();
  return instance;
}

/** The app's Drizzle client. Connects on first use. */
export const db = new Proxy({} as Db, {
  get(_target, prop) {
    const target = getDb();
    const value: unknown = Reflect.get(target, prop);
    return typeof value === "function" ? value.bind(target) : value;
  },
});
