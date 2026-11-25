import { and, asc, eq, notLike } from "drizzle-orm";
import { z } from "zod";
import { authorize, type PolicyContext } from "../../access/can";
import type { AppDb } from "../../db/app-db";
import {
  competition,
  entry,
  registration,
  participantProfile,
  schoolRound,
  schoolRoundPick,
} from "../../db/schema";
import { invalidInput } from "../../input";
import type { EventOf } from "../../outbox/events";
import { publishedResults } from "../results";
import { isSchoolRoundFinished } from "../school-round/domain/status";
import type { MilestoneKind } from "./domain/milestones";
import { recordEngagement } from "./engagement";

type Released = NonNullable<Awaited<ReturnType<typeof publishedResults>>>;
type ResultsContext = PolicyContext;

async function recordRelease(
  db: AppDb,
  ctx: ResultsContext,
  release: Released,
  digitalScope: "all_participants" | "shortlist_only"
) {
  const rows = await db
    .select({
      registrationId: registration.id,
      profileId: registration.participantProfileId,
      route: registration.route,
      submittedAt: entry.submittedAt,
      schoolStatus: schoolRound.status,
      position: schoolRoundPick.position,
    })
    .from(registration)
    .innerJoin(
      participantProfile,
      eq(participantProfile.id, registration.participantProfileId)
    )
    .leftJoin(entry, eq(entry.registrationId, registration.id))
    .leftJoin(
      schoolRound,
      eq(
        schoolRound.institutionRegistrationId,
        registration.institutionRegistrationId
      )
    )
    .leftJoin(
      schoolRoundPick,
      and(
        eq(schoolRoundPick.entryId, entry.id),
        eq(schoolRoundPick.roundId, schoolRound.id)
      )
    )
    .where(
      and(
        eq(registration.competitionId, release.competitionId),
        eq(registration.status, "confirmed"),
        // Financial erasure may keep an anonymised registration/profile.
        notLike(participantProfile.identityHash, "erased:%")
      )
    )
    .orderBy(asc(registration.participantProfileId), asc(registration.id))
    .for("no key update", { of: participantProfile });
  const finalists = new Set(
    release.lines
      .filter((line) =>
        ["winner", "runner_up", "finalist"].includes(line.outcome)
      )
      .map((line) => line.registrationId)
  );
  let facts = 0;
  for (const row of rows) {
    const decided =
      row.schoolStatus !== null && isSchoolRoundFinished(row.schoolStatus);
    const schoolWinner = decided && row.position !== null;
    const finalist = finalists.has(row.registrationId);
    const tookPart =
      schoolWinner ||
      finalist ||
      (row.route === "institution" && digitalScope === "shortlist_only"
        ? decided
        : row.submittedAt !== null);
    const kinds: MilestoneKind[] = [];
    if (tookPart) kinds.push("participant");
    if (schoolWinner) kinds.push("school_winner");
    if (finalist) kinds.push("foa_finalist");
    for (const kind of kinds) {
      await recordEngagement(db, ctx, {
        type: "milestone",
        subject: { kind: "profile", profileId: row.profileId },
        kind,
        competitionId: release.competitionId,
        occurredAt: release.publishedAt,
        sourceType: "result_release",
        sourceId: release.releaseId,
      });
      facts++;
    }
  }
  return facts;
}

type ResultEvent = EventOf<"results.published">["payload"];
async function loadAndRecord(
  ctx: ResultsContext,
  competitionId: string,
  event?: ResultEvent
) {
  return ctx.db.transaction(async (tx) => {
    // Same competition lock as publication and backfill. Rebuilds converge.
    const [comp] = await tx
      .select({ id: competition.id, digitalScope: competition.digitalScope })
      .from(competition)
      .where(eq(competition.id, competitionId))
      .for("no key update");
    if (!comp) return { ok: false, error: "not_published" } as const;
    const release = await publishedResults(tx, competitionId);
    if (
      !release ||
      (event &&
        (release.releaseId !== event.releaseId ||
          release.publishedAt.toISOString() !== event.publishedAt))
    )
      return { ok: false, error: "not_published" } as const;
    const facts = await recordRelease(
      tx,
      { ...ctx, db: tx },
      release,
      comp.digitalScope
    );
    return { ok: true, releaseId: release.releaseId, facts } as const;
  });
}

/** Worker entry point: verify the payload against the committed release. */
export async function recordPublishedEngagement(
  ctx: ResultsContext,
  input: ResultEvent
) {
  await authorize(ctx, "community.results.record");
  return loadAndRecord(ctx, input.competitionId, input);
}

export async function rebuildMilestones(
  ctx: ResultsContext,
  input: { competitionId: string }
) {
  await authorize(ctx, "community.milestones.rebuild");
  const parsed = z.strictObject({ competitionId: z.uuid() }).safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  return loadAndRecord(ctx, parsed.data.competitionId);
}
