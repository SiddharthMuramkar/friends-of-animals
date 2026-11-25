// The one writer of an adoption application's status (#130). Every move
// goes through here: it checks the move against the transition table
// (../domain/application-status.ts), writes the row, the audit entry
// (ids and statuses only) and the event that tells the applicant and the
// listing organisation, all in the caller's transaction. The caller has
// authorized the actor and locked the row. Loads under plain Node:
// relative imports only.

import { eq } from "drizzle-orm";

import type { Role } from "../../../access/domain/roles";
import type { Actor } from "../../../actor";
import { recordAudit } from "../../../audit/record";
import type { FieldCipher } from "../../../crypto/field-cipher";
import type { AppDb } from "../../../db/app-db";
import { adoptionApplication } from "../../../db/schema";
import { emit } from "../../../outbox";
import type { Clock } from "../../../ports/clock";
import {
  decideAdoptionApplicationTransition,
  isOpenAdoptionApplication,
  type AdoptionApplicationAction,
  type AdoptionApplicationActor,
  type AdoptionApplicationStatus,
  type AdoptionApplicationTransitionRefusal,
} from "../domain/application-status";
import { APPLICATION_PURPOSE } from "./record";

/** The event each status sends, naming who hears (message routes). */
export const STATUS_EVENT = {
  under_review: "adoption.application_under_review",
  in_contact: "adoption.application_in_contact",
  adopted: "adoption.application_adopted",
  not_matched: "adoption.application_not_matched",
  declined: "adoption.application_declined",
  withdrawn: "adoption.application_withdrawn",
  listing_closed: "adoption.application_listing_closed",
} as const satisfies Partial<Record<AdoptionApplicationStatus, string>>;

export type MoveApplicationInput = {
  application: { id: string; status: AdoptionApplicationStatus };
  action: AdoptionApplicationAction;
  actor: AdoptionApplicationActor;
  reason?: string | null;
  /** The role that allowed it, for the audit log. */
  actorRole: Role | null;
};

export type MoveApplicationResult =
  | {
      ok: true;
      from: AdoptionApplicationStatus;
      to: AdoptionApplicationStatus;
      closesListing: boolean;
    }
  | { ok: false; error: AdoptionApplicationTransitionRefusal };

export async function moveApplication(
  ctx: { clock: Clock; actor: Actor; cipher: FieldCipher },
  tx: AppDb,
  { application, action, actor, reason, actorRole }: MoveApplicationInput
): Promise<MoveApplicationResult> {
  const decision = decideAdoptionApplicationTransition({
    from: application.status,
    action,
    actor,
    reason,
  });
  if (!decision.ok) return { ok: false, error: decision.reason };
  const now = ctx.clock.now();
  const to = decision.to;
  await tx
    .update(adoptionApplication)
    .set({
      status: to,
      updatedAt: now,
      ...(decision.sharesContact ? { contactSharedAt: now } : {}),
      ...(isOpenAdoptionApplication(to) ? {} : { closedAt: now }),
      ...(decision.reason === null
        ? {}
        : {
            outcomeReasonCiphertext: ctx.cipher.encrypt(
              APPLICATION_PURPOSE.outcomeReason,
              decision.reason
            ),
          }),
      ...(actor === "coordinator" && ctx.actor.kind === "user"
        ? { decidedByUserId: ctx.actor.userId }
        : {}),
    })
    .where(eq(adoptionApplication.id, application.id));
  await recordAudit(tx, ctx, {
    action: "adoption.application_status_changed",
    entity: { type: "adoption_application", id: application.id },
    before: { status: application.status },
    after: { status: to },
    actorRole,
  });
  if (decision.sharesContact) {
    // The organisation can read the applicant's phone and address from now.
    await recordAudit(tx, ctx, {
      action: "adoption.contact_shared",
      entity: { type: "adoption_application", id: application.id },
      before: null,
      after: { contactShared: true },
      actorRole,
    });
  }
  if (to !== "submitted") {
    await emit(tx, ctx.clock, {
      type: STATUS_EVENT[to],
      aggregate: { type: "adoption_application", id: application.id },
      payload: { applicationId: application.id },
    });
  }
  return {
    ok: true,
    from: application.status,
    to,
    closesListing: decision.closesListing,
  };
}
