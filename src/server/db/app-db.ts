import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import type * as schema from "./schema";

/**
 * The database type use cases, adapters and seed builders accept. Both the
 * app's postgres-js client (`Db`) and the tests' PGlite client (`TestDb`)
 * fit it, and so does a transaction from either.
 *
 * `execute()` results differ between the two drivers (an array against
 * `{ rows }`), so use the query builder rather than indexing them.
 */
export type AppDb = PgDatabase<PgQueryResultHKT, typeof schema>;
