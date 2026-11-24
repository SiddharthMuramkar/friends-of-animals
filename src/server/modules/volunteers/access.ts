// Who an application belongs to, as the volunteers policy weighs it
// (./policy.ts): its applicant, and the verified guardians an active link
// joins to the teen's profile it was made on. The use cases report the
// acting user as the owner only when one of these holds; a missing
// application is refused like somebody else's.
//
// Loads under plain Node: relative imports only, no "server-only".

import { and, eq } from "drizzle-orm";

import type { Resource } from "../../access/domain/policy";
import type { Actor } from "../../actor";
import type { AppDb } from "../../db/app-db";
import { guardian, guardianLink } from "../../db/schema";
import { verifiedLink } from "../guardians/child-access";

/** Whether `userId` is a verified guardian actively linked to the profile. */
export async function isVerifiedGuardianOf(
  db: AppDb,
  userId: string,
  profileId: string
): Promise<boolean> {
  const [link] = await db
    .select({ id: guardianLink.id })
    .from(guardianLink)
    .innerJoin(guardian, eq(guardian.id, guardianLink.guardianId))
    .where(
      and(
        eq(guardian.userId, userId),
        eq(guardianLink.participantProfileId, profileId),
        verifiedLink()
      )
    )
    .limit(1);
  return link !== undefined;
}

type Owned = { participantProfileId: string | null } | null;

/** The application as the resource of the guardian's rules. */
export async function guardianResource(
  db: AppDb,
  actor: Actor,
  application: Owned
): Promise<Resource> {
  if (actor.kind !== "user" || !application?.participantProfileId) return {};
  return (await isVerifiedGuardianOf(
    db,
    actor.userId,
    application.participantProfileId
  ))
    ? { ownerId: actor.userId }
    : {};
}

/**
 * The application as the resource of withdrawing: owned by the acting
 * user when they applied, or are the applicant's verified guardian.
 */
export async function withdrawerResource(
  db: AppDb,
  actor: Actor,
  application: (Owned & { applicantUserId: string }) | null
): Promise<{ resource: Resource; by: "applicant" | "guardian" | null }> {
  if (actor.kind !== "user" || !application) return { resource: {}, by: null };
  if (application.applicantUserId === actor.userId) {
    return { resource: { ownerId: actor.userId }, by: "applicant" };
  }
  const resource = await guardianResource(db, actor, application);
  return { resource, by: resource.ownerId ? "guardian" : null };
}
