import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// The connection is opened lazily, on first use. Opening it at module scope
// would make this module side-effectful, which means Rollup could not drop it
// from the client bundle when a route imports a service purely for its
// loader — dragging the postgres driver into the browser. Keep this file
// side-effect free.
let client: postgres.Sql | undefined;

export function getClient() {
  if (!client) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error(
        "DATABASE_URL is not set. Point it at a Postgres database, e.g. " +
          "postgres://rescue:rescue@localhost:5432/rescue",
      );
    }
    client = postgres(url, {
      // Neon pooled connections (pgbouncer, transaction mode) don't support
      // prepared statements.
      prepare: false,
      // Prod runs on serverless functions; keep per-instance pools tiny.
      max: 5,
    });
  }
  return client;
}

function createDb() {
  return drizzle(getClient(), { schema });
}

export type Db = ReturnType<typeof createDb>;

let instance: Db | undefined;

function getDb() {
  if (!instance) {
    instance = createDb();
  }
  return instance;
}

export const db = /* @__PURE__ */ new Proxy({} as Db, {
  get(_target, prop) {
    const target = getDb();
    const value = Reflect.get(target, prop);
    return typeof value === "function" ? value.bind(target) : value;
  },
});

/** Closes the underlying connection pool (for scripts). */
export async function closeDb() {
  if (client) {
    await client.end();
    client = undefined;
    instance = undefined;
  }
}
