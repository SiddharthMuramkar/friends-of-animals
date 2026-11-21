import type { AppDb } from "../db/app-db";
import type { Clock } from "../ports/clock";

/** What seeders and builders write with. */
export type SeedDeps = { db: AppDb; clock: Clock };

/** Seeds one module's preview data. Must be safe to run again. */
export type Seeder = (deps: SeedDeps) => Promise<void>;
