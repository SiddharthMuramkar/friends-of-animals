// Retention for invitations (#74, #81). An invitation's link secret is
// kept readable only while the link works: the use cases clear it when an
// invitation is accepted or withdrawn, and these policies clear it a day
// after one expires unanswered ("expired" is never stored, finding carried
// from #74). The invitations themselves go 90 days (coordinators) or 30
// days (a guardian's teen, a teen's guardian request) after they close.
//
// Loads under plain Node: relative imports only, no "server-only".

import { and, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";

import {
  guardian,
  guardianInvitation,
  institutionInvitation,
  legalHold,
  user,
} from "../../../db/schema";
import {
  hashesOfVerifiedInvitee,
  verifiedInviteeFields,
} from "../../institutions/coordinators/pending-invitations";
import type { SubjectRef } from "../domain/retention-plan";
import { instant, rowPolicy, type SubjectColumn } from "./define";
import type { RetentionPolicy } from "./types";

const coordinatorSubjects = [
  ["institution", institutionInvitation.institutionId],
  ["user", institutionInvitation.invitedByUserId],
  ["user", institutionInvitation.acceptedByUserId],
  ["user", institutionInvitation.revokedByUserId],
] as const satisfies readonly SubjectColumn[];

const guardianSubjects = [
  ["participant_profile", guardianInvitation.participantProfileId],
  ["user", guardianInvitation.requestedByUserId],
  ["user", guardianInvitation.acceptedByUserId],
  [
    "user",
    sql`(SELECT ${guardian.userId} FROM ${guardian}
    WHERE ${guardian.id} = ${guardianInvitation.guardianId})`,
  ],
] as const satisfies readonly SubjectColumn[];

function withHeldInvitees(policy: RetentionPolicy): RetentionPolicy {
  return {
    ...policy,
    async candidates(db, query) {
      const page = await policy.candidates(db, query);
      if (page.candidates.length === 0) return page;
      const accounts = await db
        .select({ id: user.id, ...verifiedInviteeFields })
        .from(legalHold)
        .innerJoin(user, eq(user.id, legalHold.subjectId))
        .where(
          and(eq(legalHold.subjectType, "user"), isNull(legalHold.releasedAt))
        );
      if (accounts.length === 0) return page;

      const heldByHash = new Map<string, SubjectRef[]>();
      for (const account of accounts) {
        for (const hash of hashesOfVerifiedInvitee(query, account)) {
          const subjects = heldByHash.get(hash) ?? [];
          subjects.push({ type: "user", id: account.id });
          heldByHash.set(hash, subjects);
        }
      }
      const invitations = await db
        .select({
          id: institutionInvitation.id,
          hash: institutionInvitation.identifierHash,
        })
        .from(institutionInvitation)
        .where(
          inArray(
            institutionInvitation.id,
            page.candidates.map(({ id }) => id)
          )
        );
      const heldByInvitation = new Map(
        invitations.map(({ id, hash }) => [id, heldByHash.get(hash) ?? []])
      );
      return {
        ...page,
        candidates: page.candidates.map((candidate) => ({
          ...candidate,
          subjects: [
            ...candidate.subjects,
            ...(heldByInvitation.get(candidate.id) ?? []),
          ],
        })),
      };
    },
  };
}

export const COORDINATOR_INVITATION_LINKS = withHeldInvitees(
  rowPolicy({
    key: "coordinatorInvitationLinks",
    table: institutionInvitation,
    action: "anonymise",
    period: "coordinatorInvitationLinks",
    anchor: institutionInvitation.expiresAt,
    where: and(
      eq(institutionInvitation.status, "pending"),
      isNotNull(institutionInvitation.tokenCiphertext)
    ),
    subjects: coordinatorSubjects,
  })
);

export const GUARDIAN_INVITATION_LINKS = rowPolicy({
  key: "guardianInvitationLinks",
  table: guardianInvitation,
  action: "anonymise",
  period: "guardianInvitationLinks",
  anchor: guardianInvitation.expiresAt,
  where: and(
    eq(guardianInvitation.status, "pending"),
    isNotNull(guardianInvitation.tokenCiphertext)
  ),
  subjects: guardianSubjects,
});

/** When an invitation stopped waiting: answered, withdrawn or expired. */
function closedAt(
  table: typeof institutionInvitation | typeof guardianInvitation
) {
  return instant(
    sql`CASE ${table.status}
      WHEN 'accepted' THEN ${table.acceptedAt}
      WHEN 'revoked' THEN ${table.revokedAt}
      ELSE ${table.expiresAt} END`,
    table.expiresAt
  );
}

export const COORDINATOR_INVITATIONS = withHeldInvitees(
  rowPolicy({
    key: "coordinatorInvitations",
    table: institutionInvitation,
    action: "delete",
    period: "coordinatorInvitations",
    anchor: closedAt(institutionInvitation),
    subjects: coordinatorSubjects,
  })
);

export const GUARDIAN_INVITATIONS = rowPolicy({
  key: "guardianInvitations",
  table: guardianInvitation,
  action: "delete",
  period: "guardianInvitations",
  anchor: closedAt(guardianInvitation),
  subjects: guardianSubjects,
});
