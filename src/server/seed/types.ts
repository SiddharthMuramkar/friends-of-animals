import type { DbWithClock } from "../db/app-db";

/**
 * What seeders and builders write with. `auth.secret` seals the seeded
 * staff's authenticator secret (#60), as the app's own secret would.
 */
export type SeedDeps = DbWithClock & { auth: { secret: string } };

/** Seeds one module's preview data. Must be safe to run again. */
export type Seeder = (deps: SeedDeps) => Promise<void>;
