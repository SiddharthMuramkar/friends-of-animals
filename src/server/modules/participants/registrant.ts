// Who an individual registration is for (#78, #81): the member's own, on a
// profile of their own; a teen's whose login is linked, on the profile
// their guardian keeps; or a child the member looks after as their
// guardian. Shared by the register form and registering itself, so both
// read the same profile.

import { and, asc, eq, isNotNull, isNull } from "drizzle-orm";

import { authorize } from "../../access/can";
import type { Role } from "../../access/domain/roles";
import type { AppDb } from "../../db/app-db";
import { guardian, guardianLink, participantProfile } from "../../db/schema";
import type { UseCaseContext } from "../../use-cases";
import { childResource } from "../guardians/child-access";
import { PROFILE_PURPOSE } from "../registration/student-profile";

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
  const [linked] = await ctx.db
    .select({ id: participantProfile.id })
    .from(participantProfile)
    .where(eq(participantProfile.loginUserId, userId));
  return linked ? { kind: "linked", profileId: linked.id } : { kind: "own" };
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
