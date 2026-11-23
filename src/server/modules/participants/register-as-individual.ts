// registerAsIndividual(form) (#78, #81): a signed-in member registers for a
// competition that takes individuals, while its registration is open:
//
// - an adult registers themselves. The first time, they get a profile of
//   their own with an FOA Participant ID (FOA-P-{YY}{6}, YY the year in
//   India); a later registration finds that profile again and keeps the
//   latest details they give, except the date of birth: the profile's
//   stays, and a different one typed is refused, so a teen held for a
//   guardian can't type their way to an adult's age, nor an adult to a
//   teen's;
// - a verified guardian registers a child they look after (`forChildId`),
//   and a teen whose login is linked to a guardian registers themselves:
//   both on the child's profile, with its name and date of birth (the
//   guardian's to change, not this form's), and its Participant ID given
//   the first time;
// - a teen of 13 to 17 with no guardian on the platform registers on a
//   profile of their own and names a parent or guardian, whom FOA asks to
//   verify and accept (../guardians/guardian-request.ts).
//
// A registration waits for its fee (`pending_payment`) until
// payForMyRegistration takes it; a minor's is held (`pending_guardian`)
// until a verified guardian has accepted them and given participation
// consent (#82), which a guardian registering their child may give on this
// form, recorded in the same transaction. A child under 13 never
// registers alone.
//
// Whether they may register is the pure decision's to say
// (./domain/individual-eligibility.ts): the competition's window and route,
// the fee, the date of birth and age in India, who registers, the age
// group, a duplicate and the documents to agree to, with one reason. This
// shell loads the facts and saves the profile, the registration, the
// consents, any guardian request and the audit entry in one transaction,
// or nothing.

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
import { childResource } from "../guardians/child-access";
import {
  askGuardianFor,
  readGuardianDetails,
} from "../guardians/guardian-request";
import type { GuardianRequestRefusal } from "../guardians/domain/guardian-request";
import { offeredRoutes } from "../competitions/domain/fees";
import { getRegistrationTerms } from "../competitions/terms/read";
import {
  participationGiven,
  recordChildParticipation,
  recordRegistrationConsents,
} from "../consent";
import {
  formatIsoDate,
  type CalendarDate,
} from "../registration/domain/calendar-date";
import { identityKeyInput } from "../registration/domain/identity-key";
import { IDENTITY_HASH_PURPOSE } from "../registration/domain/prepare-student";
import { canStartIn } from "../registration/domain/registration-status";
import { registrationWindow } from "../registration/domain/registration-window";
import { ageGroupsOf } from "../registration/enrolment-facts";
import { PROFILE_PURPOSE } from "../registration/student-profile";
import {
  decideIndividualRegistration,
  type IndividualRegistrationRefusal,
} from "./domain/individual-eligibility";
import { participantCodeFormat } from "./domain/participant-code";
import {
  keptDetailsOf,
  linkedProfileOf,
  lockedKeptProfile,
  registrantOf,
  saveKeptProfile,
  subjectOf,
} from "./registrant";
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
      status: "pending_payment" | "pending_guardian";
      /**
       * The member who registered pays the fee next: theirs, or their
       * child's. A held registration waits, and a linked teen's guardian
       * pays for them.
       */
      payNow: boolean;
    }
  | InvalidInput
  | {
      ok: false;
      error:
        | "not_found"
        | IndividualRegistrationRefusal
        | GuardianRequestRefusal
        | "rate_limited";
    };

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

/**
 * The member's own profile, if they have one, with the date of birth it
 * holds (`YYYY-MM-DD`). Read under the member's user row lock, which a
 * guardian accepting their request also takes (it makes the profile the
 * guardian's), so the profile can't change hands meanwhile.
 */
async function ownProfile(
  ctx: Pick<UseCaseContext, "cipher">,
  tx: AppDb,
  userId: string
) {
  const [found] = await tx
    .select({
      id: participantProfile.id,
      participantCode: participantProfile.participantCode,
      dobCiphertext: participantProfile.dobCiphertext,
    })
    .from(participantProfile)
    .where(
      and(
        eq(participantProfile.ownerUserId, userId),
        eq(participantProfile.ownerKind, "self")
      )
    );
  if (!found) return null;
  return {
    id: found.id,
    participantCode: found.participantCode,
    dateOfBirth: ctx.cipher.decrypt(PROFILE_PURPOSE.dob, found.dobCiphertext),
  };
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

/**
 * The teen's login was linked to the profile a guardian keeps after who
 * they register was read (a guardian accepted their request meanwhile).
 */
const SUBJECT_CHANGED = Symbol("subject changed");

export async function registerAsIndividual(
  ctx: UseCaseContext,
  input: RegisterAsIndividualInput
): Promise<RegisterAsIndividualResult> {
  const first = await registerOnce(ctx, input);
  if (first !== SUBJECT_CHANGED) return first;
  // Once more, as the linked teen they are now: on the guardian's profile.
  const again = await registerOnce(ctx, input);
  if (again === SUBJECT_CHANGED) {
    throw new Error("Who registers changed twice while registering");
  }
  return again;
}

async function registerOnce(
  ctx: UseCaseContext,
  input: RegisterAsIndividualInput
): Promise<RegisterAsIndividualResult | typeof SUBJECT_CHANGED> {
  const { role: memberRole } = await authorize(
    ctx,
    "registration.individual.create"
  );
  if (ctx.actor.kind !== "user") {
    // authorize() has already refused anyone else.
    throw new Error("registerAsIndividual needs a signed-in user");
  }
  const userId = ctx.actor.userId;
  const { forChildId, guardian: guardianInput, ...typed } = input;
  const subject = await subjectOf(ctx, userId, forChildId);
  const kept = await keptDetailsOf(ctx, subject);
  // A child's name and date of birth are the profile's.
  const parsed = parseRegisterInput(kept ? { ...typed, ...kept } : typed);
  if (!parsed.ok) {
    return { ok: false, error: "invalid_input", fields: parsed.fields };
  }
  const form = parsed.value;
  const actorRole = subject.kind === "child" ? subject.actorRole : memberRole;
  const now = ctx.clock.now();

  return ctx.db.transaction(
    async (
      tx
    ): Promise<RegisterAsIndividualResult | typeof SUBJECT_CHANGED> => {
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
      if (subject.kind === "own" && (await linkedProfileOf(tx, userId))) {
        return SUBJECT_CHANGED;
      }
      const stored =
        subject.kind === "own"
          ? ({
              kind: "own",
              profile: await ownProfile(ctx, tx, userId),
            } as const)
          : ({
              kind: "kept",
              profile: await lockedKeptProfile(tx, subject.profileId),
            } as const);
      const { profile } = stored;
      if (subject.kind === "child") {
        // Again under the child's lock: a link revoked since counts.
        await authorize(
          { db: tx, clock: ctx.clock, actor: ctx.actor },
          "guardian.child.manage",
          await childResource(tx, ctx.actor, subject.profileId)
        );
      }

      // A guardian registering their child may give participation on the
      // form (#82); a minor's registration waits for payment only with it.
      const participation = terms.participationDocument;
      const participationTicked =
        subject.kind === "child" &&
        participation !== null &&
        form.consents.includes(participation.documentId);
      const decision = decideIndividualRegistration({
        competition: {
          registrationOpen: target.open,
          acceptsIndividuals: target.acceptsIndividuals,
          feeSet: terms.fees.individual !== null,
          ageCutoffDate: target.ageCutoffDate,
          ageGroups: await ageGroupsOf(tx, target.id),
        },
        dateOfBirth: form.dateOfBirth,
        storedDateOfBirth:
          stored.kind === "own"
            ? (stored.profile?.dateOfBirth ?? null)
            : (kept?.dateOfBirth ?? null),
        registrant: await registrantOf(tx, userId, subject),
        alreadyRegistered:
          profile !== null &&
          (await hasLiveRegistration(tx, profile.id, target.id)),
        consents: {
          required: terms.documents
            .filter((document) => document.required)
            .map((document) => document.documentId),
          given: form.consents,
        },
        participationGiven:
          participationTicked ||
          (subject.kind !== "own" &&
            profile !== null &&
            (await participationGiven(tx, profile.id, target.id))),
        at: now,
      });
      if (!decision.ok) return { ok: false, error: decision.reason };

      let askGuardian: ((profileId: string) => Promise<void>) | null = null;
      if (decision.askGuardian) {
        const named = readGuardianDetails(guardianInput);
        if (!named.ok) {
          return { ok: false, error: "invalid_input", fields: named.fields };
        }
        const ask = await askGuardianFor(tx, ctx, {
          profileId: profile?.id ?? null,
          requesterUserId: userId,
          details: named.details,
        });
        if (!ask.ok) return { ok: false, error: ask.error };
        askGuardian = ask.write;
      }

      const saved =
        stored.kind === "own"
          ? await saveOwnProfile(ctx, tx, userId, profile, form, decision, now)
          : await saveKeptProfile(ctx, tx, stored.profile, form, now);

      const registrationId = uuidv7(now);
      const { status } = decision;
      if (!canStartIn("individual", status)) {
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
      if (participationTicked && participation) {
        await recordChildParticipation(tx, ctx, {
          profileId: saved.id,
          competitionId: target.id,
          guardianUserId: userId,
          documentId: participation.documentId,
          actorRole,
        });
      }
      if (askGuardian) await askGuardian(saved.id);
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
          registeredBy: subject.kind === "child" ? "guardian" : "self",
          profileCreated: profile === null,
        },
        actorRole,
      });
      return {
        ok: true,
        registrationId,
        participantCode: saved.participantCode,
        status,
        payNow: status === "pending_payment" && subject.kind !== "linked",
      };
    }
  );
}

/** The member's own profile, created the first time, with the form's details. */
async function saveOwnProfile(
  ctx: UseCaseContext,
  tx: AppDb,
  userId: string,
  profile: { id: string; participantCode: string | null } | null,
  form: RegisterInput,
  decision: { dateOfBirth: CalendarDate },
  now: Date
): Promise<{ id: string; participantCode: string }> {
  const details = profileColumns(ctx, form, decision.dateOfBirth);
  return profile
    ? updateProfile(tx, profile, details, now)
    : createProfile(tx, userId, details, now);
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

/**
 * The latest details replace the old ones; the Participant ID and the date
 * of birth stay (the decision refused a different one).
 */
async function updateProfile(
  tx: AppDb,
  profile: { id: string; participantCode: string | null },
  details: ProfileColumns,
  now: Date
): Promise<{ id: string; participantCode: string }> {
  if (profile.participantCode === null) {
    throw new Error(`Profile ${profile.id} of its owner has no Participant ID`);
  }
  const { dobCiphertext: _stays, ...latest } = details;
  await tx
    .update(participantProfile)
    .set({ ...latest, updatedAt: now })
    .where(eq(participantProfile.id, profile.id));
  return { id: profile.id, participantCode: profile.participantCode };
}
