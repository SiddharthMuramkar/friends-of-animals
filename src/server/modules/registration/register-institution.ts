// registerInstitutionForCompetition({ institutionId, competitionId }) (#75):
// a coordinator, or the authorised person, of a verified institution
// registers it for a competition that takes institutions while
// registration is open. The registration gets its reference.
//
// The shell loads the facts and saves the result; whether the institution
// may register, and the one reason when it may not, is the pure
// decideInstitutionRegistration (./domain/institution-registration.ts).

import { and, eq, isNotNull } from "drizzle-orm";
import { z } from "zod";

import { authorize } from "../../access/can";
import { recordAudit } from "../../audit/record";
import type { AppDb } from "../../db/app-db";
import {
  competition,
  competitionKeyDate,
  institution,
  INSTITUTION_REGISTRATION_REFERENCE_UNIQUE,
  institutionRegistration,
} from "../../db/schema";
import { uuidv7 } from "../../ids";
import { invalidInput, type InvalidInput } from "../../input";
import { emit } from "../../outbox";
import type { UseCaseContext } from "../../use-cases";
import { withUniqueCode } from "../codes/codes";
import { institutionResource } from "../institutions/coordinators/policy";
import {
  decideInstitutionRegistration,
  type InstitutionRegistrationRefusal,
} from "./domain/institution-registration";
import { REFERENCE_SYMBOL_COUNT } from "./domain/institution-registration-reference";
import { registrationWindow } from "./domain/registration-window";

export type RegisterInstitutionForCompetitionInput = {
  institutionId: string;
  competitionId: string;
};

export type RegisterInstitutionForCompetitionResult =
  | { ok: true; registrationId: string; reference: string }
  | InvalidInput
  | { ok: false; error: InstitutionRegistrationRefusal };

const registerInput = z.object({
  institutionId: z.uuid(),
  competitionId: z.uuid(),
});

/**
 * The published competition, its registration-close date and whether it takes
 * institutions, locked for share: a status job moving it waits for this
 * registration, or this registration sees the move.
 */
async function competitionFacts(tx: AppDb, competitionId: string) {
  const [row] = await tx
    .select({
      code: competition.code,
      status: competition.status,
      participation: competition.participation,
    })
    .from(competition)
    .where(
      and(eq(competition.id, competitionId), isNotNull(competition.publishedAt))
    )
    .for("share");
  if (!row) return null;
  const [closes] = await tx
    .select({ at: competitionKeyDate.at })
    .from(competitionKeyDate)
    .where(
      and(
        eq(competitionKeyDate.competitionId, competitionId),
        eq(competitionKeyDate.kind, "registration_closes")
      )
    );
  return { ...row, registrationClosesAt: closes?.at ?? null };
}

export async function registerInstitutionForCompetition(
  ctx: UseCaseContext,
  input: RegisterInstitutionForCompetitionInput
): Promise<RegisterInstitutionForCompetitionResult> {
  const resource = institutionResource(input.institutionId);
  await authorize(ctx, "institution.coordinate", resource);
  const parsed = registerInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const { institutionId, competitionId } = parsed.data;
  const now = ctx.clock.now();
  const registeredBy = ctx.actor.kind === "user" ? ctx.actor.userId : null;

  return ctx.db.transaction(async (tx) => {
    // Shared lock: suspending the institution waits for this
    // registration, or this registration sees the suspension.
    const [registering] = await tx
      .select({ status: institution.status })
      .from(institution)
      .where(eq(institution.id, institutionId))
      .for("share");
    // Again inside the transaction: a role revoked since the first check
    // counts.
    const { role: actorRole } = await authorize(
      { db: tx, clock: ctx.clock, actor: ctx.actor },
      "institution.coordinate",
      resource
    );
    const target = await competitionFacts(tx, competitionId);
    const pair = and(
      eq(institutionRegistration.institutionId, institutionId),
      eq(institutionRegistration.competitionId, competitionId)
    );
    const [existing] = await tx
      .select({ id: institutionRegistration.id })
      .from(institutionRegistration)
      .where(pair);

    const decision = decideInstitutionRegistration({
      window: target ? registrationWindow(target, now) : "unpublished",
      // Unavailable competitions are refused before participation matters.
      participation: target?.participation ?? "individuals",
      institutionStatus: registering?.status ?? "missing",
      alreadyRegistered: existing !== undefined,
    });
    if (!decision.ok || !target) {
      return {
        ok: false,
        error: decision.ok ? "not_found" : decision.reason,
      } as const;
    }

    const registrationId = uuidv7(now);
    // A taken reference aborts its statement, so each try runs in a
    // savepoint and the transaction survives to try the next one.
    const reference = await withUniqueCode(
      {
        format: { prefix: `${target.code}-I-`, length: REFERENCE_SYMBOL_COUNT },
        constraint: INSTITUTION_REGISTRATION_REFERENCE_UNIQUE,
      },
      (code) =>
        tx.transaction(async (savepoint) => {
          // Another coordinator registering at the same moment waits on
          // the pair's unique index, then finds the row there: no insert.
          const inserted = await savepoint
            .insert(institutionRegistration)
            .values({
              id: registrationId,
              institutionId,
              competitionId,
              reference: code,
              status: decision.status,
              registeredBy,
              createdAt: now,
              updatedAt: now,
            })
            .onConflictDoNothing({
              target: [
                institutionRegistration.institutionId,
                institutionRegistration.competitionId,
              ],
            })
            .returning({ id: institutionRegistration.id });
          return inserted.length > 0 ? code : null;
        })
    );
    if (reference === null) {
      return { ok: false, error: "already_registered" } as const;
    }
    await recordAudit(tx, ctx, {
      action: "registration.institution_registered",
      entity: { type: "institution_registration", id: registrationId },
      before: null,
      after: { institutionId, competitionId, reference },
      actorRole,
    });
    // The principal is told when the outbox delivers this
    // (./principal-message.ts).
    await emit(tx, ctx.clock, {
      type: "registration.institution_registered",
      aggregate: { type: "institution_registration", id: registrationId },
      payload: { institutionRegistrationId: registrationId },
    });
    return { ok: true, registrationId, reference } as const;
  });
}
