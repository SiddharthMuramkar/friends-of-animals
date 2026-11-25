// Pin-code centres for the directory search (#128): writing them (the
// import script, the preview seed, tests) and reading one back. The import
// script turns India Post's open pin-code directory into centres with
// ./domain/pincode-import.ts; the licence and the real import wait on
// HR-59, so until then only the preview seed's sample centres exist.
//
// Loads under plain Node (the import and seed scripts): relative imports
// only, no "server-only".

import { eq, sql } from "drizzle-orm";

import type { AppDb, DbWithClock } from "../../db/app-db";
import { pincodeLocation } from "../../db/schema";
import { parseCsv } from "./domain/csv";
import type { GeoPoint } from "./domain/geo";
import {
  pincodeCentres,
  type PincodeCentre,
  type PincodeImport,
} from "./domain/pincode-import";

/** Rows per insert, well under Postgres's 65,535 parameters. */
const BATCH = 1000;

/**
 * Saves `centres`, replacing any centre already held for the same pin
 * code, so importing the same file again changes nothing but the time.
 * Returns how many it saved.
 */
export async function savePincodeCentres(
  { db, clock }: DbWithClock,
  centres: readonly PincodeCentre[]
): Promise<number> {
  const now = clock.now();
  for (let start = 0; start < centres.length; start += BATCH) {
    const rows = centres.slice(start, start + BATCH).map((centre) => ({
      pinCode: centre.pinCode,
      latitude: centre.latitude,
      longitude: centre.longitude,
      district: centre.district,
      state: centre.state,
      postOffices: centre.postOffices,
      updatedAt: now,
    }));
    await db
      .insert(pincodeLocation)
      .values(rows)
      .onConflictDoUpdate({
        target: pincodeLocation.pinCode,
        set: {
          latitude: sql`excluded.latitude`,
          longitude: sql`excluded.longitude`,
          district: sql`excluded.district`,
          state: sql`excluded.state`,
          postOffices: sql`excluded.post_offices`,
          updatedAt: sql`excluded.updated_at`,
        },
      });
  }
  return centres.length;
}

export type KnownPincode = GeoPoint & {
  pinCode: string;
  district: string | null;
  state: string | null;
};

/** The centre held for `pinCode`, or null. */
export async function pincodeCentre(
  db: AppDb,
  pinCode: string
): Promise<KnownPincode | null> {
  const [row] = await db
    .select({
      pinCode: pincodeLocation.pinCode,
      latitude: pincodeLocation.latitude,
      longitude: pincodeLocation.longitude,
      district: pincodeLocation.district,
      state: pincodeLocation.state,
    })
    .from(pincodeLocation)
    .where(eq(pincodeLocation.pinCode, pinCode));
  return row ?? null;
}

export type PincodeCsvImport =
  | (Omit<Extract<PincodeImport, { ok: true }>, "centres"> & {
      /** Pin codes saved: one centre each. */
      saved: number;
    })
  | Extract<PincodeImport, { ok: false }>;

/**
 * Imports India Post's pin-code directory, as CSV text: one centre per pin
 * code, saved over any held before. Nothing is saved when a column it
 * needs is missing.
 */
export async function importPincodeCsv(
  deps: DbWithClock,
  csv: string
): Promise<PincodeCsvImport> {
  const result = pincodeCentres(parseCsv(csv));
  if (!result.ok) return result;
  const saved = await savePincodeCentres(deps, result.centres);
  return { ok: true, rows: result.rows, skipped: result.skipped, saved };
}
