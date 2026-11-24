// What submitting an entry needs to know about a registration (#85): whose
// it is, whether it is confirmed, and its competition's code, disciplines
// and submission window. The window opens with registration and closes at
// the competition's `submissions_close` key date (#71).
//
// The participant who can see their individual registration, or the child's
// verified guardian with an active link, may submit once it is confirmed.
// On the school route (#87) a coordinator or the authorised person of the
// student's institution submits instead, while the competition's digital
// submission scope is all participants. An unknown registration, someone
// else's and another institution's student are refused the same way, before
// anything about the registration is checked.
//
// Loads under plain Node: relative imports only, no "server-only".

import { and, eq, inArray } from "drizzle-orm";

import { authorize } from "../../access/can";
import type { Role } from "../../access/domain/roles";
import type { AppDb } from "../../db/app-db";
import {
  competition,
  competitionKeyDate,
  institutionRegistration,
  participantProfile,
  registration,
} from "../../db/schema";
import type { UseCaseContext } from "../../use-cases";
import type { Discipline } from "../competitions/domain/vocabulary";
import { institutionResource } from "../institutions/coordinators/policy";
import { visibleProfiles } from "../participants/list-my-registrations";
import type { RegistrationStatus } from "../registration/domain/registration-status";
import type { SubmissionWindow } from "./domain/submission";

export type SubmissionFacts = {
  registrationId: string;
  status: RegistrationStatus;
  participantProfileId: string;
  participantName: string;
  competition: {
    id: string;
    code: string;
    name: string;
    slug: string;
    disciplines: readonly Discipline[];
    /** Null until both its dates are set. */
    window: SubmissionWindow | null;
  };
};

/**
 * Who is submitting: the participant (`mine`), a child's guardian
 * (`child`), or on the school route a coordinator for their institution's
 * student (`student`). `scopeRefusal` says why the school route takes no
 * upload from a coordinator now: its competition takes digital work from
 * the school shortlist only (#91 adds that path).
 */
export type EntrySubmitter = {
  role: Role | null;
  whose: "mine" | "child" | "student";
  scopeRefusal: "shortlist_only" | null;
};

/**
 * Authorizes submission for the actor's own or their ward's individual
 * registration, or for a student of an institution they act for (#87).
 */
export async function authorizeEntrySubmission(
  ctx: UseCaseContext,
  registrationId: string
): Promise<EntrySubmitter> {
  const actor = ctx.actor;
  const [row] =
    actor.kind === "user"
      ? await ctx.db
          .select({
            profileId: registration.participantProfileId,
            route: registration.route,
            institutionId: institutionRegistration.institutionId,
            digitalScope: competition.digitalScope,
          })
          .from(registration)
          .innerJoin(
            competition,
            eq(competition.id, registration.competitionId)
          )
          .leftJoin(
            institutionRegistration,
            eq(
              institutionRegistration.id,
              registration.institutionRegistrationId
            )
          )
          .where(eq(registration.id, registrationId))
      : [];
  if (row?.route === "institution" && row.institutionId) {
    const { role } = await authorize(
      ctx,
      "entry.submit_for_student",
      institutionResource(row.institutionId)
    );
    return {
      role,
      whose: "student",
      scopeRefusal:
        row.digitalScope === "all_participants" ? null : "shortlist_only",
    };
  }
  const visible =
    actor.kind === "user" && row?.route === "individual"
      ? (await visibleProfiles(ctx.db, actor.userId)).get(row.profileId)
      : undefined;
  const { role } = await authorize(
    ctx,
    "entry.submit",
    visible && actor.kind === "user" ? { ownerId: actor.userId } : {}
  );
  if (!visible) throw new Error("unreachable: authorized for no registration");
  return { role, whose: visible.whose, scopeRefusal: null };
}

/** Serializes entry uploads with changes to the registration's status. */
export async function lockRegistrationStatus(
  tx: AppDb,
  registrationId: string
): Promise<RegistrationStatus | undefined> {
  const [row] = await tx
    .select({ status: registration.status })
    .from(registration)
    .where(eq(registration.id, registrationId))
    .for("no key update");
  return row?.status;
}

/** The submission window of each competition in `competitionIds`. */
export async function submissionWindows(
  db: AppDb,
  competitionIds: readonly string[]
): Promise<Map<string, SubmissionWindow>> {
  const windows = new Map<string, SubmissionWindow>();
  if (competitionIds.length === 0) return windows;
  const rows = await db
    .select({
      competitionId: competitionKeyDate.competitionId,
      kind: competitionKeyDate.kind,
      at: competitionKeyDate.at,
    })
    .from(competitionKeyDate)
    .where(
      and(
        inArray(competitionKeyDate.competitionId, [...competitionIds]),
        inArray(competitionKeyDate.kind, [
          "registration_opens",
          "submissions_close",
        ])
      )
    );
  for (const id of new Set(competitionIds)) {
    const opensAt = rows.find(
      (row) => row.competitionId === id && row.kind === "registration_opens"
    )?.at;
    const closesAt = rows.find(
      (row) => row.competitionId === id && row.kind === "submissions_close"
    )?.at;
    if (opensAt && closesAt) windows.set(id, { opensAt, closesAt });
  }
  return windows;
}

/** The registration's facts, or null if there is no such registration. */
export async function submissionFacts(
  db: AppDb,
  registrationId: string
): Promise<SubmissionFacts | null> {
  const [row] = await db
    .select({
      registrationId: registration.id,
      status: registration.status,
      participantProfileId: registration.participantProfileId,
      participantName: participantProfile.fullName,
      competitionId: competition.id,
      code: competition.code,
      name: competition.name,
      slug: competition.slug,
      disciplines: competition.disciplines,
    })
    .from(registration)
    .innerJoin(
      participantProfile,
      eq(participantProfile.id, registration.participantProfileId)
    )
    .innerJoin(competition, eq(competition.id, registration.competitionId))
    .where(eq(registration.id, registrationId));
  if (!row) return null;
  const windows = await submissionWindows(db, [row.competitionId]);
  return {
    registrationId: row.registrationId,
    status: row.status,
    participantProfileId: row.participantProfileId,
    participantName: row.participantName,
    competition: {
      id: row.competitionId,
      code: row.code,
      name: row.name,
      slug: row.slug,
      disciplines: row.disciplines,
      window: windows.get(row.competitionId) ?? null,
    },
  };
}
