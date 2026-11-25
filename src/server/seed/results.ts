// Completed demonstration competition, separate from live judging examples.
// The fake historical ranking is seeded as an open snapshot, locked, then
// approved by two distinct seeded staff and published via the real worker.
import { and, eq } from "drizzle-orm";
import {
  competition,
  competitionAgeGroup,
  competitionConsentDocument,
  consentDocument,
  consentEvent,
  entry,
  judgingRound,
  judgingRoundRubric,
  participantProfile,
  registration,
  resultAward,
  resultRelease,
  roundEntry,
  roundResult,
  rubric,
  artworkResultsWindow,
  artworkReturnRequest,
  type ResultAward,
} from "../db/schema";
import { TIE_BREAK_RULE } from "../modules/judging/domain/ranking";
import {
  snapshotHash,
  publishResultsRelease,
} from "../modules/results/releases";
import { databaseSettings } from "../modules/settings/read";
import { openArtworkResultsWindow } from "../modules/physical-artwork/results-window";
import {
  SEED_AUCTION_COMPETITION,
  SEED_COMPETITION_MANAGERS,
} from "./competitions";
import { SEED_GUARDIANS } from "./guardians";
import type { Seeder } from "./types";
const id = (n: number) =>
  `01938a00-0000-7000-8000-000000099${String(n).padStart(3, "0")}`;
export const SEED_RESULTS = {
  competitionId: SEED_AUCTION_COMPETITION.id,
  roundId: id(1),
  releaseId: id(2),
  slug: SEED_AUCTION_COMPETITION.slug,
} as const;
export const seedResults: Seeder = async ({ db, clock }) => {
  const { competitionId, roundId, releaseId } = SEED_RESULTS;
  // Remove only the obsolete deterministic preview fixture, never another
  // release or another person's request. ORIG27 still has judging in flight.
  const synthetic = "01938a00-0000-7000-8000-000000093150";
  const [old] = await db
    .select()
    .from(artworkResultsWindow)
    .where(eq(artworkResultsWindow.releaseId, synthetic));
  if (old) {
    await db
      .delete(artworkReturnRequest)
      .where(
        eq(
          artworkReturnRequest.artworkId,
          "01938a00-0000-7000-8000-000000093036"
        )
      );
    await db
      .delete(artworkResultsWindow)
      .where(eq(artworkResultsWindow.releaseId, synthetic));
  }
  const [existing] = await db
    .select()
    .from(resultRelease)
    .where(eq(resultRelease.id, releaseId));
  if (existing) return;
  const now = clock.now();
  const days = (n: number) => new Date(now.getTime() + n * 86400000);
  const [comp] = await db
    .select()
    .from(competition)
    .where(eq(competition.id, competitionId));
  if (!comp) return;
  const rows = await db
    .select({
      entryId: entry.id,
      code: entry.code,
      discipline: entry.discipline,
      categoryId: registration.ageGroupId,
      profileId: participantProfile.id,
      ownerUserId: participantProfile.ownerUserId,
      ownerKind: participantProfile.ownerKind,
    })
    .from(entry)
    .innerJoin(registration, eq(registration.id, entry.registrationId))
    .innerJoin(
      participantProfile,
      eq(participantProfile.id, registration.participantProfileId)
    )
    .where(eq(entry.competitionId, competitionId));
  const [pin] = await db
    .select()
    .from(rubric)
    .where(
      and(
        eq(rubric.competitionId, competitionId),
        eq(rubric.discipline, "drawing"),
        eq(rubric.status, "published")
      )
    );
  if (!rows.length || !pin) return;
  await db
    .update(competition)
    .set({ publicDisplay: true })
    .where(eq(competition.id, competitionId));
  const [display] = await db
    .select()
    .from(consentDocument)
    .where(
      and(
        eq(consentDocument.purpose, "public_display"),
        eq(consentDocument.version, 1)
      )
    );
  if (!display) return;
  await db
    .insert(competitionConsentDocument)
    .values({
      competitionId,
      purpose: "public_display",
      consentDocumentId: display.id,
      attachedAt: days(-100),
    })
    .onConflictDoNothing();
  await db
    .insert(judgingRound)
    .values({
      id: roundId,
      competitionId,
      name: "Completed national final",
      nameKey: "completed national final",
      judgesPhysical: true,
      status: "open",
      createdAt: days(-40),
      updatedAt: days(-40),
      openedAt: days(-39),
      createdByUserId: SEED_COMPETITION_MANAGERS[0].id,
      openedByUserId: SEED_COMPETITION_MANAGERS[0].id,
    })
    .onConflictDoNothing();
  await db
    .insert(judgingRoundRubric)
    .values({ roundId, discipline: "drawing", rubricId: pin.id })
    .onConflictDoNothing();
  const groups = await db
    .select()
    .from(competitionAgeGroup)
    .where(eq(competitionAgeGroup.competitionId, competitionId));
  const lines: ResultAward[] = [];
  for (const row of rows) {
    const n = Number(row.code.at(-1));
    const placed = n !== 3;
    const outcome = placed ? "winner" : "runner_up";
    const awardPosition = placed ? 1 : 2;
    await db
      .insert(roundEntry)
      .values({ roundId, entryId: row.entryId, admittedAt: days(-38) });
    await db.insert(roundResult).values({
      roundId,
      entryId: row.entryId,
      code: row.code,
      discipline: row.discipline,
      categoryId: row.categoryId,
      rank: awardPosition,
      scoreNumerator: placed ? "90" : "80",
      scoreDenominator: "1",
      sheetsCounted: 2,
      outcome,
      awardPosition,
      suitableForAuction: true,
    });
    lines.push({
      releaseId,
      entryId: row.entryId,
      discipline: row.discipline,
      categoryId: row.categoryId,
      categoryLabel: groups.find((g) => g.id === row.categoryId)!.label,
      outcome,
      awardPosition,
      awardBand: placed ? "first" : "second",
      prize: placed ? "Gold-coloured FOA trophy" : "FOA medal",
      suitableForAuction: true,
    });
    // One adult and one minor expressly consent; the other two awards are
    // not visible. The minor's name defaults to first name + initial.
    if (n === 1 || n === 2) {
      const guardian = row.ownerKind === "guardian";
      const giverUserId = guardian
        ? SEED_GUARDIANS.guardian.id
        : row.ownerUserId;
      if (giverUserId)
        await db
          .insert(consentEvent)
          .values({
            id: id(10 + n),
            subjectType: guardian ? "participant_profile" : "user",
            subjectId: guardian ? row.profileId : giverUserId,
            giverUserId,
            competitionId,
            purpose: "public_display",
            documentId: display.id,
            action: "given",
            method: "web_form",
            occurredAt: days(-90),
          })
          .onConflictDoNothing();
    }
  }
  await db
    .update(judgingRound)
    .set({
      status: "locked",
      lockedAt: days(-10),
      lockedByUserId: SEED_COMPETITION_MANAGERS[0].id,
      tieBreakRule: TIE_BREAK_RULE,
    })
    .where(eq(judgingRound.id, roundId));
  const prepared = {
    id: releaseId,
    competitionId,
    sourceRoundId: roundId,
    preparedByUserId: SEED_COMPETITION_MANAGERS[0].id,
    preparedAt: days(-3),
    publishAt: days(-1),
    deliveryNote: "FOA will contact the family to arrange prize collection.",
  };
  await db
    .insert(resultRelease)
    .values({ ...prepared, contentHash: snapshotHash(prepared, lines) });
  await db.insert(resultAward).values(lines);
  await db
    .update(resultRelease)
    .set({
      status: "approved",
      approvedByUserId: SEED_COMPETITION_MANAGERS[1].id,
      approvedAt: days(-2),
    })
    .where(eq(resultRelease.id, releaseId));
  const historicalClock = { now: () => days(-1) };
  const result = await publishResultsRelease(
    {
      db,
      clock: historicalClock,
      actor: { kind: "system", process: "worker" },
    },
    { competitionId, releaseId }
  );
  if (!result.ok || result.outcome !== "published")
    throw new Error("Seed results could not publish");
  await openArtworkResultsWindow(
    { db, clock, settings: databaseSettings(db) },
    { competitionId, releaseId, publishedAt: days(-1).toISOString() }
  );
};
