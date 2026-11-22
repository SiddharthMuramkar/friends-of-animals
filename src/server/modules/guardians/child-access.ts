// Which children a guardian may act for (#81): those an active
// guardian_link joins to the acting user's guardian record. The guardian
// policy's per-child rule (./policy.ts) allows a guardian acting on a
// child whose owner, as this file reports it, is themselves.
//
// Loads under plain Node: relative imports only, no "server-only".

import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { z } from "zod";

import type { Resource } from "../../access/domain/policy";
import type { Actor } from "../../actor";
import type { AppDb } from "../../db/app-db";
import { guardian, guardianLink } from "../../db/schema";

const childIdInput = z.uuid();

/** Live links: a revoked one stays as history and grants nothing. */
export function activeLinkOf(userId: string, childId: string) {
  return and(
    eq(guardian.userId, userId),
    eq(guardianLink.participantProfileId, childId),
    isNull(guardianLink.revokedAt)
  );
}

/**
 * A live link whose guardian has verified, on guardian_link joined to
 * guardian: the one that lets them see, register and pay for the child,
 * and that a linked teen counts as having a guardian.
 */
export function verifiedLink() {
  return and(isNull(guardianLink.revokedAt), isNotNull(guardian.verifiedAt));
}

/**
 * A child as the resource of the per-child rule: owned by the acting user
 * when an active link joins them, by nobody otherwise. A child that
 * doesn't exist, or an id that can't be one, is refused the same way as
 * somebody else's.
 */
export async function childResource(
  db: AppDb,
  actor: Actor,
  childId: unknown
): Promise<Resource> {
  if (actor.kind !== "user" || !childIdInput.safeParse(childId).success) {
    return {};
  }
  const [link] = await db
    .select({ id: guardianLink.id })
    .from(guardianLink)
    .innerJoin(guardian, eq(guardian.id, guardianLink.guardianId))
    .where(activeLinkOf(actor.userId, childId as string));
  return link ? { ownerId: actor.userId } : {};
}
