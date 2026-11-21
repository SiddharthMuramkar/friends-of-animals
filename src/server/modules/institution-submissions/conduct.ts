// Conduct certification (#87): once per institution registration, a
// coordinator confirms the competition and its judging ran in the school
// as FOA's guidelines say. Finalising the school round (#89) requires it.
//
// Loads under plain Node: relative imports only, no "server-only".

import { eq } from "drizzle-orm";

import type { AppDb } from "../../db/app-db";
import { conductCertification } from "../../db/schema";
import { DomainError } from "../../errors";

/**
 * Throws DomainError("conduct_not_certified") unless the registration's
 * conduct is certified. Finalising the school round (#89) calls it inside
 * its transaction.
 */
export async function requireConductCertified(
  db: AppDb,
  institutionRegistrationId: string
): Promise<void> {
  const [row] = await db
    .select({ id: conductCertification.id })
    .from(conductCertification)
    .where(
      eq(
        conductCertification.institutionRegistrationId,
        institutionRegistrationId
      )
    )
    .limit(1);
  if (!row) {
    throw new DomainError(
      "conduct_not_certified",
      "The institution's conduct is not certified for this registration"
    );
  }
}
