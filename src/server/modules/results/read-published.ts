// Internal released recognition seam for certificates, engagement and gallery.
// Never use this private projection as a public DTO. No unpublished fallback.
import { and, asc, eq } from "drizzle-orm";
import type { AppDb } from "../../db/app-db";
import {
  competition,
  entry,
  resultAward,
  resultRelease,
} from "../../db/schema";

export async function publishedResults(db: AppDb, competitionId: string) {
  const [release] = await db
    .select({
      releaseId: resultRelease.id,
      competitionId: resultRelease.competitionId,
      sourceRoundId: resultRelease.sourceRoundId,
      publishedAt: resultRelease.publishedAt,
    })
    .from(resultRelease)
    .innerJoin(competition, eq(resultRelease.competitionId, competition.id))
    .where(
      and(
        eq(competition.id, competitionId),
        eq(competition.status, "results_published"),
        eq(resultRelease.status, "published")
      )
    );
  if (!release?.publishedAt) return null;
  const lines = await db
    .select({
      entryId: resultAward.entryId,
      registrationId: entry.registrationId,
      participantProfileId: entry.participantProfileId,
      discipline: resultAward.discipline,
      categoryId: resultAward.categoryId,
      categoryLabel: resultAward.categoryLabel,
      outcome: resultAward.outcome,
      awardPosition: resultAward.awardPosition,
      awardBand: resultAward.awardBand,
      suitableForAuction: resultAward.suitableForAuction,
      prize: resultAward.prize,
    })
    .from(resultAward)
    .innerJoin(entry, eq(entry.id, resultAward.entryId))
    .where(eq(resultAward.releaseId, release.releaseId))
    .orderBy(
      asc(resultAward.discipline),
      asc(resultAward.categoryLabel),
      asc(resultAward.awardPosition),
      asc(resultAward.outcome),
      asc(resultAward.entryId)
    );
  return { ...release, publishedAt: release.publishedAt, lines };
}

/** One immutable published recognition label, without scores, prize or category. */
export async function publishedRecognitionForEntry(db: AppDb, entryId: string) {
  const [recognition] = await db
    .select({ outcome: resultAward.outcome, awardBand: resultAward.awardBand })
    .from(resultAward)
    .innerJoin(entry, eq(entry.id, resultAward.entryId))
    .innerJoin(
      resultRelease,
      and(
        eq(resultRelease.id, resultAward.releaseId),
        eq(resultRelease.competitionId, entry.competitionId)
      )
    )
    .innerJoin(competition, eq(competition.id, resultRelease.competitionId))
    .where(
      and(
        eq(entry.id, entryId),
        eq(resultRelease.status, "published"),
        eq(competition.status, "results_published")
      )
    );
  if (!recognition || recognition.outcome === "none") return null;
  return recognition.awardBand
    ? { kind: "band" as const, value: recognition.awardBand }
    : { kind: "outcome" as const, value: recognition.outcome };
}
