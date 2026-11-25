// An adoption application's row (#130): the purposes the field cipher binds
// its encrypted fields to, loading and locking one, the animal and
// organisation it is for, and the coordinator's scope. Loads under plain
// Node (the worker and the seed script): relative imports only, no
// "server-only".

import { and, eq, isNull } from "drizzle-orm";

import { authorize } from "../../../access/can";
import type { Resource } from "../../../access/domain/policy";
import type { Role } from "../../../access/domain/roles";
import { grantsOf } from "../../../access/grants";
import type { FieldCipher } from "../../../crypto/field-cipher";
import type { AppDb } from "../../../db/app-db";
import type { Ciphertext } from "../../../crypto/field-cipher";
import {
  adoptionApplication,
  adoptionListing,
  directoryListing,
  userRole,
} from "../../../db/schema";
import { DomainError } from "../../../errors";
import type { UseCaseContext } from "../../../use-cases";
import { isPubliclyListed } from "../../directory/domain/listing-status";
import type { AdoptionAnswers } from "../domain/application-input";
import type { AdoptionAction } from "../policy";

/** The purposes the cipher binds an application's fields to. */
export const APPLICATION_PURPOSE = {
  dob: "adoption_application.dob",
  phone: "adoption_application.phone",
  address: "adoption_application.address",
  answers: "adoption_application.answers",
  outcomeReason: "adoption_application.outcome_reason",
} as const;

/** The applicant's contact and answers, decrypted. */
export type ApplicantDetails = {
  phone: string;
  address: string;
  answers: AdoptionAnswers;
};

export function decryptDetails(
  cipher: FieldCipher,
  row: {
    phoneCiphertext: Ciphertext;
    addressCiphertext: Ciphertext;
    answersCiphertext: Ciphertext;
  }
): ApplicantDetails {
  return {
    phone: cipher.decrypt(APPLICATION_PURPOSE.phone, row.phoneCiphertext),
    address: cipher.decrypt(APPLICATION_PURPOSE.address, row.addressCiphertext),
    answers: JSON.parse(
      cipher.decrypt(APPLICATION_PURPOSE.answers, row.answersCiphertext)
    ) as AdoptionAnswers,
  };
}

/** One application with its animal and organisation, locked if asked. */
export async function applicationWithListing(
  db: AppDb,
  applicationId: string,
  { lock = false }: { lock?: boolean } = {}
) {
  const query = db
    .select({
      application: adoptionApplication,
      listing: {
        id: adoptionListing.id,
        slug: adoptionListing.slug,
        name: adoptionListing.name,
        species: adoptionListing.species,
        status: adoptionListing.status,
        directoryListingId: adoptionListing.directoryListingId,
      },
      directory: { name: directoryListing.name, slug: directoryListing.slug },
    })
    .from(adoptionApplication)
    .innerJoin(
      adoptionListing,
      eq(adoptionListing.id, adoptionApplication.adoptionListingId)
    )
    .innerJoin(
      directoryListing,
      eq(directoryListing.id, adoptionListing.directoryListingId)
    )
    .where(eq(adoptionApplication.id, applicationId));
  const [row] = lock
    ? await query.for("update", { of: adoptionApplication })
    : await query;
  return row ?? null;
}

export type ApplicationWithListing = NonNullable<
  Awaited<ReturnType<typeof applicationWithListing>>
>;

/** The listing a slug names, with its organisation's standing, if any. */
export async function listingBySlug(
  db: AppDb,
  slug: string,
  { share = false }: { share?: boolean } = {}
) {
  const query = db
    .select({
      id: adoptionListing.id,
      slug: adoptionListing.slug,
      name: adoptionListing.name,
      species: adoptionListing.species,
      status: adoptionListing.status,
      directoryListingId: adoptionListing.directoryListingId,
      directoryName: directoryListing.name,
      directoryStatus: directoryListing.status,
    })
    .from(adoptionListing)
    .innerJoin(
      directoryListing,
      eq(directoryListing.id, adoptionListing.directoryListingId)
    )
    .where(eq(adoptionListing.slug, slug));
  // Sharing the listing's row lock keeps an adoption recorded at the same
  // moment from missing this application when it closes the others.
  const [row] = share
    ? await query.for("share", { of: adoptionListing })
    : await query;
  if (!row) return null;
  return { ...row, directoryVerified: isPubliclyListed(row.directoryStatus) };
}

/** Whether `userId` represents the directory listing. */
export async function representsListing(
  db: AppDb,
  userId: string,
  directoryListingId: string
): Promise<boolean> {
  const [row] = await db
    .select({ id: userRole.id })
    .from(userRole)
    .where(
      and(
        eq(userRole.userId, userId),
        eq(userRole.role, "organisation_representative"),
        eq(userRole.scopeType, "organisation"),
        eq(userRole.scopeId, directoryListingId)
      )
    )
    .limit(1);
  return row !== undefined;
}

/** The scope a directory listing's people hold. */
export function organisationScope(directoryListingId: string): Resource {
  return { scopes: [{ type: "organisation", id: directoryListingId }] };
}

/**
 * Which organisations' applications the coordinator may see: every one
 * for a global grant, else those of their organisation-scoped grants.
 * Asks the policy (and so the second factor) on the scopes they hold, so
 * anyone without the role is refused.
 */
export async function coordinatorScope(
  ctx: UseCaseContext,
  action: AdoptionAction
): Promise<{ role: Role | null; organisations: "all" | string[] }> {
  const grants =
    ctx.actor.kind === "user" ? await grantsOf(ctx.db, ctx.actor.userId) : [];
  const held = grants.filter((grant) => grant.role === "adoption_coordinator");
  const global = held.some((grant) => grant.scope.type === "global");
  const organisations = held.flatMap((grant) =>
    grant.scope.type === "organisation" ? [grant.scope.id] : []
  );
  const { role } = await authorize(
    ctx,
    action,
    global
      ? {}
      : {
          scopes: organisations.map((id) => ({
            type: "organisation" as const,
            id,
          })),
        }
  );
  return { role, organisations: global ? "all" : organisations };
}

/** Refuses like a missing record, so ids can't be probed. */
export function refused(ctx: UseCaseContext, action: string): never {
  throw new DomainError("forbidden", `${ctx.actor.kind} may not ${action}`);
}

/** Every user holding the adoption coordinator role everywhere. */
export async function globalCoordinators(db: AppDb): Promise<string[]> {
  const rows = await db
    .selectDistinct({ userId: userRole.userId })
    .from(userRole)
    .where(
      and(
        eq(userRole.role, "adoption_coordinator"),
        eq(userRole.scopeType, "global"),
        isNull(userRole.scopeId)
      )
    );
  return rows.map((row) => row.userId).sort();
}
