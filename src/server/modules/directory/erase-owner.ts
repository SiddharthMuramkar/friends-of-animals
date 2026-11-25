// Called only inside the approved privacy erasure transaction (#115).
// A listing is also the organisation to which representatives and adoption
// records belong, so keep its identity as a record rather than deleting
// other people's data. Its former public slug and details may identify the
// person requesting erasure and must not survive as a public listing.

import { and, asc, eq, inArray, notInArray } from "drizzle-orm";

import { recordAudit } from "../../audit/record";
import type { FieldCipher } from "../../crypto/field-cipher";
import type { AppDb } from "../../db/app-db";
import { directoryListing, userRole } from "../../db/schema";
import type { OutboxDeps } from "../../outbox";
import { TOMBSTONE } from "../privacy/domain/anonymise";
import { isIndividualListing } from "./domain/catalogue";
import { LISTING_ADDRESS, LISTING_CONTACT_PHONE } from "./stored-listing";

const OPEN = ["pending_verification", "verified", "suspended"] as const;
const ERASURE_REASON = "Listing owner requested erasure";

export async function eraseOwnedListings(
  tx: AppDb,
  deps: { clock: OutboxDeps["clock"]; cipher: FieldCipher },
  users: string[],
  onLegalHold: boolean
): Promise<void> {
  if (users.length === 0) return;
  const listings = await tx
    .select()
    .from(directoryListing)
    .where(inArray(directoryListing.ownerUserId, users))
    .orderBy(asc(directoryListing.id))
    .for("update");
  for (const listing of listings) {
    const now = deps.clock.now();
    let successor: string | null = null;
    const open = (OPEN as readonly string[]).includes(listing.status);
    if (onLegalHold) {
      // Preserve evidence and ownership under a hold, but close publication
      // permanently so staff cannot inadvertently reinstate the old details.
      if (!open) continue;
      await tx
        .update(directoryListing)
        .set({
          status: "withdrawn",
          statusReason: ERASURE_REASON,
          statusChangedAt: now,
          statusChangedByUserId: null,
          updatedAt: now,
        })
        .where(eq(directoryListing.id, listing.id));
    } else {
      // Only an existing scoped representative can take over an open
      // organisational listing, and only if the one-open-listing rule
      // permits it. A person's own rescue/foster listing cannot be transferred.
      if (open && !isIndividualListing(listing.type)) {
        const alreadyOwns = tx
          .select({ id: directoryListing.ownerUserId })
          .from(directoryListing)
          .where(
            and(
              inArray(directoryListing.status, [...OPEN]),
              // The constraint ensures open listings have an owner.
              notInArray(directoryListing.ownerUserId, users)
            )
          );
        const [other] = await tx
          .select({ id: userRole.userId })
          .from(userRole)
          .where(
            and(
              eq(userRole.role, "organisation_representative"),
              eq(userRole.scopeType, "organisation"),
              eq(userRole.scopeId, listing.id),
              notInArray(userRole.userId, users),
              notInArray(userRole.userId, alreadyOwns)
            )
          )
          .orderBy(asc(userRole.grantedAt), asc(userRole.userId))
          .limit(1)
          .for("update");
        successor = other?.id ?? null;
      }
      await tx
        .update(directoryListing)
        .set({
          ownerUserId: successor,
          // A handover remains pending until the representative replaces the
          // identifying details and staff verify them. Never publish old contacts.
          status: successor
            ? "pending_verification"
            : listing.status === "rejected"
              ? "rejected"
              : "withdrawn",
          slug: `erased-${listing.id}`,
          name: TOMBSTONE,
          description: TOMBSTONE,
          addressCiphertext: deps.cipher.encrypt(LISTING_ADDRESS, TOMBSTONE),
          city: TOMBSTONE,
          state: TOMBSTONE,
          // A placeholder which satisfies the required six-digit column. It
          // can never be public until someone supplies new details.
          pinCode: "100000",
          contactPhoneCiphertext: deps.cipher.encrypt(
            LISTING_CONTACT_PHONE,
            TOMBSTONE
          ),
          contactEmailCiphertext: null,
          website: null,
          publicContactFields: [],
          statusReason: ERASURE_REASON,
          statusChangedAt: now,
          statusChangedByUserId: null,
          updatedAt: now,
        })
        .where(eq(directoryListing.id, listing.id));
    }
    await recordAudit(
      tx,
      { clock: deps.clock, actor: { kind: "system", process: "worker" } },
      {
        action: onLegalHold
          ? "directory.listing_withdrawn"
          : successor
            ? "directory.listing_handed_over"
            : "directory.listing_anonymised",
        entity: { type: "directory_listing", id: listing.id },
        before: {
          status: listing.status,
          ...(onLegalHold ? { reason: listing.statusReason } : {}),
        },
        after: {
          status: onLegalHold
            ? "withdrawn"
            : successor
              ? "pending_verification"
              : listing.status === "rejected"
                ? "rejected"
                : "withdrawn",
          ...(successor ? { ownerUserId: successor } : {}),
        },
        actorRole: null,
      }
    );
  }
}
