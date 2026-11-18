import "server-only";

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { env } from "@/env";

import { directTls, resolveDatabaseUrl } from "./database-url";
import * as schema from "./schema";

// The connection opens lazily, on first use, so importing this module needs
// no database. `next build` imports it without one.
function createDb() {
  const config = env();
  // A preview's DATABASE_URL names a placeholder database; this connects to
  // the preview's own instead (SPEC §2.4).
  const url = resolveDatabaseUrl(config.DATABASE_URL, config);
  const client = postgres(url, {
    // TLS and how the certificate is checked come from the URL's sslmode
    // (verify-full on Vercel; the local URL has none and stays plain). When
    // it encrypts, start TLS on the first byte to save a round trip.
    ...directTls(url),
    // PgBouncer in transaction mode (our only public database endpoint)
    // doesn't support prepared statements.
    prepare: false,
    // Each Vercel Function instance keeps its own small pool.
    max: 5,
    // Close idle connections soon, so instances that sit idle don't hold
    // PgBouncer client slots for long.
    idle_timeout: 20,
    // Fail a request in seconds rather than the default 30 when PgBouncer
    // can't be reached.
    connect_timeout: 5,
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
