// Whether an institution registration's conduct is certified (#87), for
// the steps that need it. Finalising the school round (#89) checks it
// inside its own transaction, after it has authorized the actor: with
// `isConductCertified` to answer `{ ok: false, error: "conduct_not_certified" }`
// (an expected outcome the page explains), or with `requireConductCertified`,
// which throws.
//
// Loads under plain Node: relative imports only, no "server-only".

import { eq } from "drizzle-orm";

import type { AppDb } from "../../db/app-db";
import { conductCertification } from "../../db/schema";

/** Whether the institution registration's conduct is certified. */
export async function isConductCertified(
  db: AppDb,
  institutionRegistrationId: string
): Promise<boolean> {
  const [row] = await db
    .select({ id: conductCertification.id })
    .from(conductCertification)
    .where(
      eq(
        conductCertification.institutionRegistrationId,
        institutionRegistrationId
      )
    );
  return row !== undefined;
}

/** Thrown by `requireConductCertified`. */
export class ConductNotCertifiedError extends Error {
  readonly code = "conduct_not_certified";

  constructor(readonly institutionRegistrationId: string) {
    super("The institution has not certified the competition's conduct");
    this.name = "ConductNotCertifiedError";
  }
}

/**
 * Throws ConductNotCertifiedError unless the institution registration's
 * conduct is certified.
 */
export async function requireConductCertified(
  db: AppDb,
  institutionRegistrationId: string
): Promise<void> {
  if (!(await isConductCertified(db, institutionRegistrationId))) {
    throw new ConductNotCertifiedError(institutionRegistrationId);
  }
}
