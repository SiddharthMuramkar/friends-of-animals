// registerAsIndividual(form) (#78): a signed-in adult registers themselves
// for a competition that takes individuals, while its registration is
// open. The first time, they get a profile of their own with an FOA
// Participant ID (FOA-P-{YY}{6}, YY the year in India); a later
// registration finds that profile again and keeps the latest details they
// give. The registration waits for its fee (`pending_payment`) until
// payForMyRegistration takes it.
//
// Whether they may register is the pure decision's to say
// (./domain/individual-eligibility.ts): the competition's window and route,
// the fee, their date of birth and age in India, the age group, a
// duplicate and the documents to agree to, with one reason. This shell
// loads the facts and saves the profile, the registration, the consents
// and the audit entry in one transaction, or nothing.

import { and, eq, ne } from "drizzle-orm";

import { authorize } from "../../access/can";
import { recordAudit } from "../../audit/record";
import type { AppDb } from "../../db/app-db";
import {
  competition,
  competitionKeyDate,
  participantProfile,
  PARTICIPANT_CODE_UNIQUE,
  registration,
  user,
} from "../../db/schema";
import { uuidv7 } from "../../ids";
import type { InvalidInput } from "../../input";
import type { UseCaseContext } from "../../use-cases";
import { withUniqueCode } from "../codes/codes";
import { offeredRoutes } from "../competitions/domain/fees";
import { getRegistrationTerms } from "../competitions/terms/read";
import { recordRegistrationConsents } from "../consent";
import { formatIsoDate } from "../registration/domain/calendar-date";
import { identityKeyInput } from "../registration/domain/identity-key";
import { IDENTITY_HASH_PURPOSE } from "../registration/domain/prepare-student";
import { initialRegistrationStatus } from "../registration/domain/registration-status";
import { registrationWindow } from "../registration/domain/registration-window";
import { ageGroupsOf } from "../registration/enrolment-facts";
import { PROFILE_PURPOSE } from "../registration/student-profile";
import {
  decideIndividualRegistration,
  type IndividualRegistrationRefusal,
} from "./domain/individual-eligibility";
import { participantCodeFormat } from "./domain/participant-code";
import {
  parseRegisterInput,
  type RegisterAsIndividualInput,
  type RegisterInput,
} from "./register-input";

export type { RegisterAsIndividualInput } from "./register-input";

export type RegisterAsIndividualResult =
  | {
      ok: true;
      registrationId: string;
      participantCode: string;
      status: "pending_payment";
    }
  | InvalidInput
  | { ok: false; error: "not_found" | IndividualRegistrationRefusal };

/**
 * The competition named by `slug`, share-locked so a status job waits for
 * this registration; null for none, or a draft.
 */
async function competitionFacts(tx: AppDb, slug: string, now: Date) {
  const [found] = await tx
    .select({
      id: competition.id,
      status: competition.status,
      participation: competition.participation,
      ageCutoffDate: competition.ageCutoffDate,
    })
    .from(competition)
    .where(eq(competition.slug, slug))
    .for("share");
  if (!found || found.status === "draft") return null;
  if (found.ageCutoffDate === null) {
    throw new Error("A published competition has no age cut-off date");
  }
  const [closes] = await tx
    .select({ at: competitionKeyDate.at })
    .from(competitionKeyDate)
    .where(
      and(
        eq(competitionKeyDate.competitionId, found.id),
        eq(competitionKeyDate.kind, "registration_closes")
      )
    );
  return {
    id: found.id,
    ageCutoffDate: found.ageCutoffDate,
    open:
      registrationWindow(
        { status: found.status, registrationClosesAt: closes?.at ?? null },
        now
      ) === "open",
    acceptsIndividuals: offeredRoutes(found.participation).includes(
      "individual"
    ),
  };
}

/** The adult's own profile, if they have one. */
async function ownProfile(tx: AppDb, userId: string) {
  const [found] = await tx
    .select({
      id: participantProfile.id,
      participantCode: participantProfile.participantCode,
    })
    .from(participantProfile)
    .where(
      and(
        eq(participantProfile.ownerUserId, userId),
        eq(participantProfile.ownerKind, "self")
      )
    );
  return found ?? null;
}

async function hasLiveRegistration(
  tx: AppDb,
  profileId: string,
  competitionId: string
): Promise<boolean> {
  const [found] = await tx
    .select({ id: registration.id })
    .from(registration)
    .where(
      and(
        eq(registration.participantProfileId, profileId),
        eq(registration.competitionId, competitionId),
        ne(registration.status, "withdrawn")
      )
    )
    .limit(1);
  return found !== undefined;
}

export async function registerAsIndividual(
  ctx: UseCaseContext,
  input: RegisterAsIndividualInput
): Promise<RegisterAsIndividualResult> {
  const { role: actorRole } = await authorize(
    ctx,
    "registration.individual.create"
  );
  if (ctx.actor.kind !== "user") {
    // authorize() has already refused anyone else.
    throw new Error("registerAsIndividual needs a signed-in user");
  }
  const userId = ctx.actor.userId;
  const parsed = parseRegisterInput(input);
  if (!parsed.ok) {
    return { ok: false, error: "invalid_input", fields: parsed.fields };
  }
  const form = parsed.value;
  const now = ctx.clock.now();

  return ctx.db.transaction(async (tx): Promise<RegisterAsIndividualResult> => {
    const target = await competitionFacts(tx, form.competitionSlug, now);
    if (!target) return { ok: false, error: "not_found" };
    const terms = await getRegistrationTerms(tx, target.id);
    if (!terms) return { ok: false, error: "not_found" };
    // One person's registrations take turns, so the duplicate check and
    // the first profile see every earlier one.
    await tx
      .select({ id: user.id })
      .from(user)
      .where(eq(user.id, userId))
      .for("no key update");
    const profile = await ownProfile(tx, userId);

    const decision = decideIndividualRegistration({
      competition: {
        registrationOpen: target.open,
        acceptsIndividuals: target.acceptsIndividuals,
        feeSet: terms.fees.individual !== null,
        ageCutoffDate: target.ageCutoffDate,
        ageGroups: await ageGroupsOf(tx, target.id),
      },
      dateOfBirth: form.dateOfBirth,
      alreadyRegistered:
        profile !== null &&
        (await hasLiveRegistration(tx, profile.id, target.id)),
      consents: {
        required: terms.documents
          .filter((document) => document.required)
          .map((document) => document.documentId),
        given: form.consents,
      },
      at: now,
    });
    if (!decision.ok) return { ok: false, error: decision.reason };

    const details = profileColumns(ctx, form, decision.dateOfBirth);
    const saved = profile
      ? await updateProfile(tx, profile, details, now)
      : await createProfile(tx, userId, details, now);

    const registrationId = uuidv7(now);
    const { status } = initialRegistrationStatus("individual");
    if (status !== "pending_payment") {
      throw new Error(`An individual registration can't start ${status}`);
    }
    await tx.insert(registration).values({
      id: registrationId,
      participantProfileId: saved.id,
      competitionId: target.id,
      route: "individual",
      ageGroupId: decision.ageGroup.id,
      status,
      createdAt: now,
      updatedAt: now,
    });
    const given = new Set(form.consents);
    await recordRegistrationConsents(tx, ctx, {
      userId,
      documents: terms.documents
        .filter((document) => given.has(document.documentId))
        .map(({ purpose, documentId }) => ({ purpose, documentId })),
    });
    await recordAudit(tx, ctx, {
      action: "registration.individual_registered",
      entity: { type: "registration", id: registrationId },
      before: null,
      after: {
        participantProfileId: saved.id,
        competitionId: target.id,
        ageGroupId: decision.ageGroup.id,
        route: "individual",
        status,
        profileCreated: profile === null,
      },
      actorRole,
    });
    return {
      ok: true,
      registrationId,
      participantCode: saved.participantCode,
      status,
    };
  });
}

type ProfileColumns = ReturnType<typeof profileColumns>;

/** The profile columns that hold the form's details, DOB and phone encrypted. */
function profileColumns(
  ctx: Pick<UseCaseContext, "cipher" | "blindIndex">,
  form: RegisterInput,
  dateOfBirth: Parameters<typeof formatIsoDate>[0]
) {
  return {
    fullName: form.fullName,
    dobCiphertext: ctx.cipher.encrypt(
      PROFILE_PURPOSE.dob,
      formatIsoDate(dateOfBirth)
    ),
    phoneCiphertext: ctx.cipher.encrypt(PROFILE_PURPOSE.phone, form.phone),
    pinCode: form.pinCode,
    city: form.city,
    state: form.state,
    country: form.country,
    schoolName: form.schoolName,
    identityHash: ctx.blindIndex.of(
      IDENTITY_HASH_PURPOSE,
      identityKeyInput(form.fullName, dateOfBirth)
    ),
  };
}

/** A first profile of their own, with a Participant ID not yet taken. */
async function createProfile(
  tx: AppDb,
  userId: string,
  details: ProfileColumns,
  now: Date
): Promise<{ id: string; participantCode: string }> {
  const id = uuidv7(now);
  const participantCode = await withUniqueCode(
    { format: participantCodeFormat(now), constraint: PARTICIPANT_CODE_UNIQUE },
    (code) =>
      // A savepoint, so a code already taken draws another.
      tx.transaction(async (savepoint) => {
        await savepoint.insert(participantProfile).values({
          id,
          ownerKind: "self",
          ownerUserId: userId,
          participantCode: code,
          ...details,
          createdBy: userId,
          createdAt: now,
          updatedAt: now,
        });
        return code;
      })
  );
  return { id, participantCode };
}

/** The latest details replace the old ones; the Participant ID stays. */
async function updateProfile(
  tx: AppDb,
  profile: { id: string; participantCode: string | null },
  details: ProfileColumns,
  now: Date
): Promise<{ id: string; participantCode: string }> {
  if (profile.participantCode === null) {
    throw new Error(`Profile ${profile.id} of its owner has no Participant ID`);
  }
  await tx
    .update(participantProfile)
    .set({ ...details, updatedAt: now })
    .where(eq(participantProfile.id, profile.id));
  return { id: profile.id, participantCode: profile.participantCode };
}
