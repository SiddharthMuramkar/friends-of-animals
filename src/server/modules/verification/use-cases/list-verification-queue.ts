// listVerificationQueue({ competitionId?, route? }) (#92): the FOA
// verifier's queue: every entry waiting for verification
// (`submitted_to_foa`), from both routes, oldest arrival first. An entry
// arrives when its school round is finalised (school route), when
// submissions close (individual route), or when it is resubmitted after a
// send-back. Items say where the entry came from, but not who made it.
//
// Loads under plain Node: relative imports only, no "server-only".

import {
  and,
  asc,
  eq,
  ne,
  isNotNull,
  max,
  sql,
  notExists,
  inArray,
} from "drizzle-orm";
import { z } from "zod";

import { authorize } from "../../../access/can";
import {
  competition,
  competitionAgeGroup,
  entry,
  entryFile,
  entryTransition,
  entryVerification,
  institution,
  institutionRegistration,
  registration,
} from "../../../db/schema";
import { invalidInput, type InvalidInput } from "../../../input";
import type { UseCaseContext } from "../../../use-cases";
import type { Discipline } from "../../competitions/domain/vocabulary";

export const VERIFICATION_ROUTES = ["school", "individual"] as const;

export type VerificationRoute = (typeof VERIFICATION_ROUTES)[number];

const queueInput = z.object({
  competitionId: z.uuid().optional(),
  route: z.enum(VERIFICATION_ROUTES).optional(),
});

export type ListVerificationQueueInput = z.input<typeof queueInput>;

export type VerificationQueueItem = {
  entryId: string;
  code: string;
  title: string;
  discipline: Discipline;
  /** The registration's age group, which with the discipline makes the category. */
  ageGroupLabel: string | null;
  competition: { id: string; name: string; code: string };
  route: VerificationRoute;
  /** The school's name on the school route; null on the individual route. */
  institutionName: string | null;
  /** When it last arrived at FOA. */
  arrivedAt: Date;
  /** It was sent back before and has been resubmitted. */
  resubmitted: boolean;
};

export type ListVerificationQueueResult =
  | { ok: true; items: VerificationQueueItem[] }
  | InvalidInput;

export async function listVerificationQueue(
  ctx: UseCaseContext,
  input: ListVerificationQueueInput
): Promise<ListVerificationQueueResult> {
  await authorize(ctx, "verification.read");
  const parsed = queueInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const { competitionId, route } = parsed.data;

  const arrivals = ctx.db
    .select({
      entryId: entryTransition.entryId,
      arrivedAt: max(entryTransition.at).as("arrived_at"),
    })
    .from(entryTransition)
    .where(eq(entryTransition.toStatus, "submitted_to_foa"))
    .groupBy(entryTransition.entryId)
    .as("arrivals");
  const resubmissions = ctx.db
    .selectDistinct({ entryId: entryVerification.entryId })
    .from(entryVerification)
    .where(isNotNull(entryVerification.resubmittedAt))
    .as("resubmissions");

  const rows = await ctx.db
    .select({
      entryId: entry.id,
      code: entry.code,
      title: entry.title,
      discipline: entry.discipline,
      ageGroupLabel: competitionAgeGroup.label,
      competitionId: competition.id,
      competitionName: competition.name,
      competitionCode: competition.code,
      registrationRoute: registration.route,
      institutionName: institution.name,
      arrivedAt: arrivals.arrivedAt,
      resubmitted: sql<boolean>`${resubmissions.entryId} is not null`,
    })
    .from(entry)
    .innerJoin(registration, eq(registration.id, entry.registrationId))
    .innerJoin(competition, eq(competition.id, entry.competitionId))
    .innerJoin(arrivals, eq(arrivals.entryId, entry.id))
    .leftJoin(
      competitionAgeGroup,
      eq(competitionAgeGroup.id, registration.ageGroupId)
    )
    .leftJoin(
      institutionRegistration,
      eq(institutionRegistration.id, registration.institutionRegistrationId)
    )
    .leftJoin(
      institution,
      eq(institution.id, institutionRegistration.institutionId)
    )
    .leftJoin(resubmissions, eq(resubmissions.entryId, entry.id))
    .where(
      and(
        eq(entry.status, "submitted_to_foa"),
        ne(competition.status, "cancelled"),
        eq(registration.status, "confirmed"),
        notExists(
          ctx.db
            .select({ id: entryFile.id })
            .from(entryFile)
            .where(
              and(
                eq(entryFile.entryId, entry.id),
                inArray(entryFile.status, ["pending", "processing"])
              )
            )
        ),
        ...(competitionId ? [eq(entry.competitionId, competitionId)] : []),
        ...(route
          ? [
              eq(
                registration.route,
                route === "school" ? "institution" : "individual"
              ),
            ]
          : [])
      )
    )
    .orderBy(asc(arrivals.arrivedAt), asc(entry.code));

  return {
    ok: true,
    items: rows.map((row) => ({
      entryId: row.entryId,
      code: row.code,
      title: row.title,
      discipline: row.discipline,
      ageGroupLabel: row.ageGroupLabel,
      competition: {
        id: row.competitionId,
        name: row.competitionName,
        code: row.competitionCode,
      },
      route: row.registrationRoute === "institution" ? "school" : "individual",
      institutionName: row.institutionName,
      arrivedAt: new Date(row.arrivedAt as unknown as string | Date),
      resubmitted: Boolean(row.resubmitted),
    })),
  };
}
