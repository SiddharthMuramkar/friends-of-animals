import { and, eq, inArray, or, exists } from "drizzle-orm";
import type { AppDb } from "../../db/app-db";
import {
  guardian,
  guardianLink,
  institutionRegistration,
  participantProfile,
  registration,
} from "../../db/schema";
import type { UseCaseContext } from "../../use-cases";
import { ageAt } from "../participants/domain/age";
import { parseIsoDate } from "../registration/domain/calendar-date";
import { PROFILE_PURPOSE } from "../registration/student-profile";
import { grantsOf } from "../../access/grants";
import { verifiedLink } from "../guardians/child-access";
import { communityMemberFor } from "../community";
import {
  affiliationAt,
  type ClubRole,
  type Affiliations,
} from "./domain/membership";

type IdentityContext = Pick<UseCaseContext, "cipher" | "clock">;
/** Reject known underage self-owned pending profiles (guardian acceptance
 * moves them to a guardian profile) and known linked teens without a live
 * verified guardian. Unknown-age users may self-attest, but their notices
 * remain in-app. Never guess an account's affiliation from school data. */
async function permittedIdentity(
  db: AppDb,
  ctx: IdentityContext,
  userId: string
) {
  const profiles = await db
    .select({
      id: participantProfile.id,
      loginUserId: participantProfile.loginUserId,
      dob: participantProfile.dobCiphertext,
    })
    .from(participantProfile)
    .where(
      or(
        eq(participantProfile.loginUserId, userId),
        and(
          eq(participantProfile.ownerKind, "self"),
          eq(participantProfile.ownerUserId, userId)
        )
      )
    );
  for (const profile of profiles) {
    if (profile.loginUserId === userId) {
      const [active] = await db
        .select({ id: guardianLink.id })
        .from(guardianLink)
        .innerJoin(guardian, eq(guardian.id, guardianLink.guardianId))
        .where(
          and(eq(guardianLink.participantProfileId, profile.id), verifiedLink())
        );
      if (!active) return false;
    } else {
      const date = parseIsoDate(
        ctx.cipher.decrypt(PROFILE_PURPOSE.dob, profile.dob)
      );
      if (!date || ageAt(date, ctx.clock.now()) < 18) return false;
    }
  }
  return true;
}

/** No browser-supplied affiliation, name or email matching. A school
 * registration must be linked to one's actual profile and, for a teen,
 * their guardian link must still be verified and active. */
export async function loadAffiliations(
  db: AppDb,
  ctx: IdentityContext,
  userId: string
): Promise<Affiliations> {
  if (!(await permittedIdentity(db, ctx, userId)))
    return { teacherOf: new Set(), studentOf: new Set() };
  const teacherOf = new Set(
    (await grantsOf(db, userId)).flatMap((grant) =>
      grant.scope.type === "institution" &&
      (grant.role === "institution_admin" ||
        grant.role === "institution_coordinator")
        ? [grant.scope.id]
        : []
    )
  );
  const linkedGuardian = db
    .select({ id: guardianLink.id })
    .from(guardianLink)
    .innerJoin(guardian, eq(guardian.id, guardianLink.guardianId))
    .where(
      and(
        eq(guardianLink.participantProfileId, participantProfile.id),
        verifiedLink()
      )
    );
  const students = await db
    .selectDistinct({ id: institutionRegistration.institutionId })
    .from(registration)
    .innerJoin(
      participantProfile,
      eq(participantProfile.id, registration.participantProfileId)
    )
    .innerJoin(
      institutionRegistration,
      eq(institutionRegistration.id, registration.institutionRegistrationId)
    )
    .where(
      and(
        eq(registration.route, "institution"),
        inArray(registration.status, ["enrolled", "confirmed"]),
        or(
          and(
            eq(participantProfile.ownerKind, "self"),
            eq(participantProfile.ownerUserId, userId)
          ),
          and(
            eq(participantProfile.loginUserId, userId),
            exists(linkedGuardian)
          )
        )
      )
    );
  return { teacherOf, studentOf: new Set(students.map(({ id }) => id)) };
}

/** Self-attestation is a prospect's claim, never an access grant. Only
 * active community members may use it; known linked teens need a live link. */
export async function canSelfAttest(
  db: AppDb,
  ctx: IdentityContext,
  userId: string
) {
  const member = await communityMemberFor(db, { kind: "user", userId });
  return (
    member?.status === "active" && (await permittedIdentity(db, ctx, userId))
  );
}
export async function affiliationFor(
  db: AppDb,
  ctx: IdentityContext,
  userId: string,
  institutionId: string,
  claim?: ClubRole
) {
  const role = affiliationAt(
    institutionId,
    await loadAffiliations(db, ctx, userId)
  );
  if (role) return { role, verified: true };
  if (claim && (await canSelfAttest(db, ctx, userId)))
    return { role: claim, verified: false };
  return null;
}
