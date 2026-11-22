// Who an individual registration is for (#78, #81): the member's own, on a
// profile of their own; a teen's whose login is linked, on the profile
// their guardian keeps; or a child the member looks after as their
// guardian. Shared by the register form and registering itself, so both
// read the same profile; registering also locks and saves a
// guardian-kept profile here, and weighs who registers for the minor
// rules.

import { and, asc, eq, isNotNull, isNull } from "drizzle-orm";

import { authorize } from "../../access/can";
import type { Role } from "../../access/domain/roles";
import type { AppDb } from "../../db/app-db";
import {
  guardian,
  guardianLink,
  participantProfile,
  PARTICIPANT_CODE_UNIQUE,
} from "../../db/schema";
import type { UseCaseContext } from "../../use-cases";
import { withUniqueCode } from "../codes/codes";
import { childResource } from "../guardians/child-access";
import { hasVerifiedGuardian } from "../guardians/guardian-request";
import { guardianOfUser } from "../guardians/guardian-record";
import { PROFILE_PURPOSE } from "../registration/student-profile";
import type { MinorRegistrant } from "./domain/minor-registration";
import { participantCodeFormat } from "./domain/participant-code";
import type { RegisterInput } from "./register-input";

export type Subject =
  | { kind: "own" }
  | { kind: "linked"; profileId: string }
  | { kind: "child"; profileId: string; actorRole: Role | null };

/** A guardian-kept profile's name and date of birth (`YYYY-MM-DD`). */
export async function keptProfile(
  ctx: Pick<UseCaseContext, "cipher">,
  db: AppDb,
  profileId: string
): Promise<{ fullName: string; dateOfBirth: string } | null> {
  const [row] = await db
    .select({
      fullName: participantProfile.fullName,
      dobCiphertext: participantProfile.dobCiphertext,
    })
    .from(participantProfile)
    .where(
      and(
        eq(participantProfile.id, profileId),
        eq(participantProfile.ownerKind, "guardian")
      )
    );
  if (!row) return null;
  return {
    fullName: row.fullName,
    dateOfBirth: ctx.cipher.decrypt(PROFILE_PURPOSE.dob, row.dobCiphertext),
  };
}

/**
 * Who the registration is for. Naming a child needs the guardian's link
 * to them (refused as forbidden otherwise, like any child of somebody
 * else's); a linked teen login always registers on their own child
 * profile, never on a profile of their own with a typed date of birth.
 */
export async function subjectOf(
  ctx: UseCaseContext,
  userId: string,
  forChildId: string | undefined
): Promise<Subject> {
  if (forChildId !== undefined) {
    const { role } = await authorize(
      ctx,
      "guardian.child.manage",
      await childResource(ctx.db, ctx.actor, forChildId)
    );
    return { kind: "child", profileId: forChildId, actorRole: role };
  }
  const linked = await linkedProfileOf(ctx.db, userId);
  return linked ? { kind: "linked", profileId: linked } : { kind: "own" };
}

/** The guardian-kept profile `userId` is the login of, if any. */
export async function linkedProfileOf(
  db: AppDb,
  userId: string
): Promise<string | null> {
  const [linked] = await db
    .select({ id: participantProfile.id })
    .from(participantProfile)
    .where(eq(participantProfile.loginUserId, userId));
  return linked?.id ?? null;
}

/** The children `userId` looks after as a verified guardian, oldest first. */
export async function childrenOf(
  db: AppDb,
  userId: string
): Promise<{ id: string; fullName: string }[]> {
  return db
    .select({
      id: participantProfile.id,
      fullName: participantProfile.fullName,
    })
    .from(guardianLink)
    .innerJoin(guardian, eq(guardian.id, guardianLink.guardianId))
    .innerJoin(
      participantProfile,
      eq(participantProfile.id, guardianLink.participantProfileId)
    )
    .where(
      and(
        eq(guardian.userId, userId),
        isNotNull(guardian.verifiedAt),
        isNull(guardianLink.revokedAt)
      )
    )
    .orderBy(asc(participantProfile.createdAt), asc(participantProfile.id));
}

/** A guardian-kept profile, locked so registrations of it take turns. */
export async function lockedKeptProfile(tx: AppDb, profileId: string) {
  const [found] = await tx
    .select({
      id: participantProfile.id,
      participantCode: participantProfile.participantCode,
    })
    .from(participantProfile)
    .where(eq(participantProfile.id, profileId))
    .for("update");
  if (!found) throw new Error(`Profile ${profileId} is gone`);
  return found;
}

/** Who is registering, as the minor rules need it. */
export async function registrantOf(
  tx: AppDb,
  userId: string,
  subject: Subject
): Promise<MinorRegistrant> {
  switch (subject.kind) {
    case "child": {
      const record = await guardianOfUser(tx, userId);
      return { kind: "guardian", verified: record?.verifiedAt != null };
    }
    case "linked":
      // A linked teen whose guardians are all gone waits for one, without
      // asking anyone new from here.
      return {
        kind: "self",
        guardian: (await hasVerifiedGuardian(tx, subject.profileId))
          ? "verified"
          : "unverified",
      };
    case "own":
      // A profile of one's own has no guardian: a teen on it names one.
      return { kind: "self", guardian: "none" };
  }
}

/**
 * A guardian-kept profile takes the form's contact and address; its name
 * and date of birth stay the guardian's. It gets its Participant ID on its
 * first registration.
 */
export async function saveKeptProfile(
  ctx: UseCaseContext,
  tx: AppDb,
  profile: { id: string; participantCode: string | null },
  form: RegisterInput,
  now: Date
): Promise<{ id: string; participantCode: string }> {
  const contact = {
    phoneCiphertext: ctx.cipher.encrypt(PROFILE_PURPOSE.phone, form.phone),
    pinCode: form.pinCode,
    city: form.city,
    state: form.state,
    country: form.country,
    schoolName: form.schoolName,
    updatedAt: now,
  };
  if (profile.participantCode !== null) {
    await tx
      .update(participantProfile)
      .set(contact)
      .where(eq(participantProfile.id, profile.id));
    return { id: profile.id, participantCode: profile.participantCode };
  }
  const participantCode = await withUniqueCode(
    { format: participantCodeFormat(now), constraint: PARTICIPANT_CODE_UNIQUE },
    (code) =>
      tx.transaction(async (savepoint) => {
        await savepoint
          .update(participantProfile)
          .set({ ...contact, participantCode: code })
          .where(eq(participantProfile.id, profile.id));
        return code;
      })
  );
  return { id: profile.id, participantCode };
}
