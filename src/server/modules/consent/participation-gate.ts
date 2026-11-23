// The participation gate (#82): a minor takes part only with their
// guardian's participation consent, given on the competition's attached
// version. A minor's registration is held (`pending_guardian`) until a
// verified guardian has given it; giving it releases the registration to
// wait for payment in the same transaction; and without it, paying refuses
// and the capture path confirms nothing (../registration/confirm.ts).
//
// A minor's registration here is an individual one on a profile a
// guardian keeps (#81): a guardian's child, or a teen whose login is
// linked. A school's student takes part on the school route (#83), and an
// adult's own profile is never gated.
//
// Not use cases: callers have authorized their actor and pass their
// transaction. Loads under plain Node: relative imports only.

import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";

import type { Role } from "../../access/domain/roles";
import { recordAudit } from "../../audit/record";
import type { AppDb } from "../../db/app-db";
import {
  competitionConsentDocument,
  guardian,
  guardianLink,
  participantProfile,
  registration,
} from "../../db/schema";
import type { UseCaseContext } from "../../use-cases";
import { canTransition } from "../registration/domain/registration-status";
import { appendConsentEvent } from "./consents";
import type { ConsentContext } from "./documents";
import { currentConsent } from "./domain/consent-state";
import { minorRegistrationHold } from "./domain/guardian-purposes";
import { lockProfileSubject, subjectEvents } from "./repository";

/** The participation version the competition has attached, if any. */
async function attachedParticipation(
  db: AppDb,
  competitionId: string
): Promise<string | null> {
  const [pinned] = await db
    .select({ id: competitionConsentDocument.consentDocumentId })
    .from(competitionConsentDocument)
    .where(
      and(
        eq(competitionConsentDocument.competitionId, competitionId),
        eq(competitionConsentDocument.purpose, "participation")
      )
    );
  return pinned?.id ?? null;
}

/**
 * Whether the child's participation in the competition is given on the
 * version it has attached now. With no participation document attached,
 * it never is: the safe side.
 */
export async function participationGiven(
  db: AppDb,
  profileId: string,
  competitionId: string
): Promise<boolean> {
  const attached = await attachedParticipation(db, competitionId);
  if (attached === null) return false;
  const state = currentConsent(
    await subjectEvents(
      db,
      { type: "participant_profile", id: profileId },
      "participation",
      competitionId
    )
  );
  return state.status === "given" && state.documentId === attached;
}

/** Whether a verified guardian looks after the profile through a live link. */
async function guardianVerified(db: AppDb, profileId: string) {
  const [row] = await db
    .select({ id: guardianLink.id })
    .from(guardianLink)
    .innerJoin(guardian, eq(guardian.id, guardianLink.guardianId))
    .where(
      and(
        eq(guardianLink.participantProfileId, profileId),
        isNull(guardianLink.revokedAt),
        isNotNull(guardian.verifiedAt)
      )
    )
    .limit(1);
  return row !== undefined;
}

/**
 * Releases the profile's registrations held for a guardian (in one
 * competition, or in all), each whose guardian has verified and given
 * participation: they wait for payment now, each with its audit entry.
 * Returns their ids.
 */
export async function releaseHeldRegistrations(
  tx: AppDb,
  ctx: Pick<UseCaseContext, "clock" | "actor">,
  input: { profileId: string; competitionId?: string; actorRole: Role | null }
): Promise<string[]> {
  if (!canTransition("pending_guardian", "pending_payment", "guardian")) {
    throw new Error("The registration machine no longer releases held ones");
  }
  const held = await tx
    .select({ id: registration.id, competitionId: registration.competitionId })
    .from(registration)
    .where(
      and(
        eq(registration.participantProfileId, input.profileId),
        eq(registration.status, "pending_guardian"),
        ...(input.competitionId
          ? [eq(registration.competitionId, input.competitionId)]
          : [])
      )
    )
    .orderBy(registration.id)
    .for("update");
  if (held.length === 0) return [];
  const verified = await guardianVerified(tx, input.profileId);
  const released: string[] = [];
  for (const row of held) {
    const hold = minorRegistrationHold({
      minor: true,
      guardianVerified: verified,
      participationGiven: await participationGiven(
        tx,
        input.profileId,
        row.competitionId
      ),
    });
    if (hold === null) released.push(row.id);
  }
  if (released.length === 0) return [];
  await tx
    .update(registration)
    .set({ status: "pending_payment", updatedAt: ctx.clock.now() })
    .where(inArray(registration.id, released));
  for (const id of released) {
    await recordAudit(tx, ctx, {
      action: "registration.status_changed",
      entity: { type: "registration", id },
      before: { status: "pending_guardian" },
      after: { status: "pending_payment", cause: "guardian" },
      actorRole: input.actorRole,
    });
  }
  return released;
}

/** Giving participation releases the child's registration held for it. */
export function releaseOnParticipation(
  tx: AppDb,
  ctx: Pick<UseCaseContext, "clock" | "actor">,
  input: { profileId: string; competitionId: string; actorRole: Role | null }
): Promise<string[]> {
  return releaseHeldRegistrations(tx, ctx, input);
}

/**
 * The registrations among `registrationIds` that are a minor's and lack
 * participation consent on their competition's attached version: paying
 * for them is refused and the capture confirms none of them.
 */
export async function lackingParticipation(
  db: AppDb,
  registrationIds: readonly string[]
): Promise<Set<string>> {
  const lacking = new Set<string>();
  if (registrationIds.length === 0) return lacking;
  const rows = await db
    .select({
      id: registration.id,
      profileId: registration.participantProfileId,
      competitionId: registration.competitionId,
    })
    .from(registration)
    .innerJoin(
      participantProfile,
      eq(participantProfile.id, registration.participantProfileId)
    )
    .where(
      and(
        inArray(registration.id, [...registrationIds]),
        eq(registration.route, "individual"),
        eq(participantProfile.ownerKind, "guardian")
      )
    );
  for (const row of rows) {
    if (!(await participationGiven(db, row.profileId, row.competitionId))) {
      lacking.add(row.id);
    }
  }
  return lacking;
}

/**
 * Records the participation consent a verified guardian gave on their
 * child's registration form, in the registration's transaction
 * (registerAsIndividual has authorized them as the child's guardian):
 * given by web form to the competition's attached version, which the
 * caller passes. Given on that version already, it records nothing.
 */
export async function recordChildParticipation(
  tx: AppDb,
  ctx: ConsentContext,
  input: {
    profileId: string;
    competitionId: string;
    guardianUserId: string;
    documentId: string;
    actorRole: Role | null;
  }
): Promise<void> {
  const subject = { type: "participant_profile", id: input.profileId } as const;
  await lockProfileSubject(tx, input.profileId);
  const state = currentConsent(
    await subjectEvents(tx, subject, "participation", input.competitionId)
  );
  if (state.status === "given" && state.documentId === input.documentId) {
    return;
  }
  await appendConsentEvent(tx, ctx, state, {
    subject,
    giverUserId: input.guardianUserId,
    purpose: "participation",
    action: "given",
    documentId: input.documentId,
    method: "web_form",
    competitionId: input.competitionId,
    actorRole: input.actorRole,
  });
}
