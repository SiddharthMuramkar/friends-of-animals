// Applying to volunteer (#123).
//
//   applyToVolunteer(input)             → a signed-in member, for themselves
//   acceptVolunteerDeclarations(input)  → the applicant, on their open one
//
// FOA vets anyone who will work near children. The age comes from the date
// of birth on the applicant's participant profile when they have one (a
// teen's is the one their guardian entered), or else the date they type,
// counted on India's calendar at the clock's instant. Under the minimum
// age (14) is refused and nothing is written; a minor (under 18) applies
// only with a verified guardian, who decides first. Both declarations are
// accepted, on their current versions, in the same transaction as the
// application, so they commit together or not at all.
//
// Loads under plain Node: relative imports only.

import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { authorize } from "../../access/can";
import { grantsOf } from "../../access/grants";
import { recordAudit } from "../../audit/record";
import { volunteerApplication } from "../../db/schema";
import { uuidv7 } from "../../ids";
import { invalidInput, type InvalidInput } from "../../input";
import { emit } from "../../outbox";
import type { UseCaseContext } from "../../use-cases";
import { lockUserSubject } from "../consent/repository";
import { hasVerifiedGuardian } from "../guardians/child-access";
import { ageAt, parseDateOfBirth } from "../participants/domain/age";
import { formatIsoDate } from "../registration/domain/calendar-date";
import {
  applicantProfileOf,
  DATE_OF_BIRTH_PURPOSE,
  latestApplicationOf,
} from "./application-record";
import { OPEN_VOLUNTEER_APPLICATION_STATUSES } from "./domain/application-status";
import {
  availabilitySchema,
  volunteerInterestsSchema,
} from "./domain/application-input";
import {
  decideVolunteerApplication,
  type VolunteerApplicationRefusal,
} from "./domain/eligibility";
import {
  recordDeclarations,
  type AcceptedDeclarations,
  type DeclarationRefusal,
} from "./declarations";

export type ApplyToVolunteerInput = AcceptedDeclarations & {
  interests: readonly string[];
  availability: {
    slots: readonly { day: string; part: string }[];
    note?: string | null;
  };
  /**
   * `YYYY-MM-DD`, asked only of someone with no participant profile; a
   * profile's date of birth always wins.
   */
  dateOfBirth?: string;
};

export type ApplyToVolunteerResult =
  | {
      ok: true;
      applicationId: string;
      status: "awaiting_guardian" | "submitted";
    }
  | InvalidInput
  | {
      ok: false;
      error:
        | "applications_closed"
        | "date_of_birth_required"
        | VolunteerApplicationRefusal
        | DeclarationRefusal;
    };

const applyInput = z.object({
  interests: volunteerInterestsSchema,
  availability: availabilitySchema,
  dateOfBirth: z.string().optional(),
  safeguardingDocumentId: z.uuid(),
  conductDocumentId: z.uuid(),
});

function signedInUser(ctx: UseCaseContext): string {
  // authorize() has already refused anyone else.
  if (ctx.actor.kind !== "user") throw new Error("Needs a signed-in user");
  return ctx.actor.userId;
}

/** Applies for the signed-in member. */
export async function applyToVolunteer(
  ctx: UseCaseContext,
  input: ApplyToVolunteerInput
): Promise<ApplyToVolunteerResult> {
  const { role: actorRole } = await authorize(ctx, "volunteer.apply");
  const userId = signedInUser(ctx);
  if (!(await ctx.settings.get("volunteers.applicationsOpen"))) {
    return { ok: false, error: "applications_closed" };
  }
  const parsed = applyInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const { interests, availability, dateOfBirth: typed } = parsed.data;
  const now = ctx.clock.now();
  const rules = {
    minAgeYears: await ctx.settings.get("volunteers.minAgeYears"),
    guardianApprovalBelowAgeYears: await ctx.settings.get(
      "volunteers.guardianApprovalBelowAgeYears"
    ),
  };

  return ctx.db.transaction(async (tx) => {
    // Applying, accepting a declaration and granting a role all take the
    // user's row lock, so two applications at once queue.
    await lockUserSubject(tx, userId);
    const profile = await applicantProfileOf(tx, ctx.cipher, userId);
    let dateOfBirth = profile?.dateOfBirth ?? null;
    if (!dateOfBirth) {
      if (typed === undefined || typed.trim() === "") {
        return { ok: false, error: "date_of_birth_required" } as const;
      }
      dateOfBirth = parseDateOfBirth(typed.trim(), now);
      if (!dateOfBirth) {
        return {
          ok: false,
          error: "invalid_input",
          fields: ["dateOfBirth"],
        } as const;
      }
    }
    const grants = await grantsOf(tx, userId);
    const open = await tx
      .select({ id: volunteerApplication.id })
      .from(volunteerApplication)
      .where(
        and(
          eq(volunteerApplication.applicantUserId, userId),
          inArray(
            volunteerApplication.status,
            OPEN_VOLUNTEER_APPLICATION_STATUSES
          )
        )
      );
    const decision = decideVolunteerApplication({
      applicant: {
        ageYears: ageAt(dateOfBirth, now),
        guardian:
          profile && (await hasVerifiedGuardian(tx, profile.id))
            ? "verified"
            : "none",
        isVolunteer: grants.some(
          (grant) => grant.role === "volunteer" && grant.scope.type === "global"
        ),
        hasOpenApplication: open.length > 0,
      },
      rules,
    });
    if (!decision.ok) return { ok: false, error: decision.reason } as const;

    const declared = await recordDeclarations(tx, ctx, userId, parsed.data);
    if (!declared.ok) {
      // Nothing was recorded: the declarations check before writing.
      return declared;
    }
    const id = uuidv7(now);
    await tx.insert(volunteerApplication).values({
      id,
      applicantUserId: userId,
      participantProfileId: profile?.id ?? null,
      dateOfBirthCiphertext: ctx.cipher.encrypt(
        DATE_OF_BIRTH_PURPOSE,
        formatIsoDate(dateOfBirth)
      ),
      interests,
      availability,
      status: decision.status,
      createdAt: now,
      updatedAt: now,
    });
    await recordAudit(tx, ctx, {
      action: "volunteer.application_submitted",
      entity: { type: "volunteer_application", id },
      before: null,
      after: {
        status: decision.status,
        participantProfileId: profile?.id ?? null,
      },
      actorRole,
    });
    await emit(tx, ctx.clock, {
      type:
        decision.status === "awaiting_guardian"
          ? "volunteer.guardian_approval_requested"
          : "volunteer.application_submitted",
      aggregate: { type: "volunteer_application", id },
      payload: { applicationId: id },
    });
    return { ok: true, applicationId: id, status: decision.status } as const;
  });
}

export type AcceptVolunteerDeclarationsResult =
  | { ok: true; changed: boolean }
  | InvalidInput
  | { ok: false; error: "no_open_application" | DeclarationRefusal };

const acceptInput = z.object({
  safeguardingDocumentId: z.uuid(),
  conductDocumentId: z.uuid(),
});

/**
 * Accepts the current versions of both declarations again, after staff
 * published a newer one while the applicant's application is open: a
 * community manager can approve only on current versions.
 */
export async function acceptVolunteerDeclarations(
  ctx: UseCaseContext,
  input: AcceptedDeclarations
): Promise<AcceptVolunteerDeclarationsResult> {
  await authorize(ctx, "volunteer.apply");
  const userId = signedInUser(ctx);
  const parsed = acceptInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);

  return ctx.db.transaction(async (tx) => {
    await lockUserSubject(tx, userId);
    const latest = await latestApplicationOf(tx, userId);
    if (
      !latest ||
      !(OPEN_VOLUNTEER_APPLICATION_STATUSES as readonly string[]).includes(
        latest.status
      )
    ) {
      return { ok: false, error: "no_open_application" } as const;
    }
    return recordDeclarations(tx, ctx, userId, parsed.data);
  });
}
