import type { BlindIndex } from "../crypto/blind-index";
import type { FieldCipher } from "../crypto/field-cipher";
import type { DbWithClock } from "../db/app-db";

/**
 * What seeders and builders write with: the database, the clock, and the
 * field cipher and blind index for personal data (a seeded phone).
 */
export type SeedDeps = DbWithClock & {
  cipher: FieldCipher;
  blindIndex: BlindIndex;
};

/** Seeds one module's preview data. Must be safe to run again. */
export type Seeder = (deps: SeedDeps) => Promise<void>;
