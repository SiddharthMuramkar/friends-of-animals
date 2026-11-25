// Closing an animal's open applications when its listing closes (#130):
// once the coordinator records an adoption, every other open application
// on the animal ends `listing_closed`; so does every open one when the
// representative withdraws the listing (#129). Runs in the transaction that
// closes the listing, which holds the listing's row lock, so an
// application made at the same moment waits and then finds the listing
// closed. Each applicant is told once. Loads under plain Node.

import { and, eq, inArray } from "drizzle-orm";

import type { Role } from "../../../access/domain/roles";
import type { Actor } from "../../../actor";
import type { FieldCipher } from "../../../crypto/field-cipher";
import type { AppDb } from "../../../db/app-db";
import { adoptionApplication } from "../../../db/schema";
import type { Clock } from "../../../ports/clock";
import { OPEN_ADOPTION_APPLICATION_STATUSES } from "../domain/application-status";
import { moveApplication } from "./move";

export async function closeOpenApplications(
  ctx: { clock: Clock; actor: Actor; cipher: FieldCipher },
  tx: AppDb,
  { listingId, actorRole }: { listingId: string; actorRole: Role | null }
): Promise<number> {
  const open = await tx
    .select({ id: adoptionApplication.id, status: adoptionApplication.status })
    .from(adoptionApplication)
    .where(
      and(
        eq(adoptionApplication.adoptionListingId, listingId),
        inArray(adoptionApplication.status, OPEN_ADOPTION_APPLICATION_STATUSES)
      )
    )
    .orderBy(adoptionApplication.createdAt, adoptionApplication.id)
    .for("update");
  for (const application of open) {
    const moved = await moveApplication(ctx, tx, {
      application,
      action: "close_listing",
      actor: "system",
      actorRole,
    });
    if (!moved.ok)
      throw new Error(`Could not close application ${application.id}`);
  }
  return open.length;
}
