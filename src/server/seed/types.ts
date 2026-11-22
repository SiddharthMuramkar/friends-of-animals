import type { BlindIndex } from "../crypto/blind-index";
import type { FieldCipher } from "../crypto/field-cipher";
import type { DbWithClock } from "../db/app-db";

/**
 * What seeders and builders write with: the database, the clock, the
 * field cipher and blind index for personal data (a seeded phone), and
 * `auth.secret`, which seals the seeded staff's authenticator secret
 * (#60), as the app's own secret would.
 */
export type SeedDeps = DbWithClock & {
  cipher: FieldCipher;
  blindIndex: BlindIndex;
  auth: { secret: string };
};

/** Seeds one module's preview data. Must be safe to run again. */
export type Seeder = (deps: SeedDeps) => Promise<void>;
