// Reading and writing a whole competition: its row, age groups, categories
// and key dates. The use cases and the seed write through here, so a
// competition is stored one way. Loads under plain Node (the seed script):
// relative imports only, no "server-only".

import { asc, eq } from "drizzle-orm";

import type { AppDb } from "../../db/app-db";
import {
  competition,
  competitionAgeGroup,
  competitionCategory,
  competitionKeyDate,
  type Competition,
} from "../../db/schema";
import { uuidv7 } from "../../ids";
import type { KeyDates } from "./domain/key-dates";
import { orderedKeyDates } from "./domain/key-dates";
import { DISCIPLINES, type PhysicalArtwork } from "./domain/vocabulary";
import type { CompetitionValues } from "./fields";

/** A stored competition: its row and its values. */
export type StoredCompetition = {
  row: Competition;
  values: CompetitionValues;
};

function physicalArtworkOf(row: Competition): PhysicalArtwork {
  if (row.physicalArtwork === "top_n") {
    return { kind: "top_n", count: row.physicalArtworkTopN ?? 0 };
  }
  return { kind: row.physicalArtwork };
}

/**
 * The competition with this id, or null. `lock` holds its row until the
 * transaction ends, so two changes to one competition queue.
 */
export async function loadCompetition(
  db: AppDb,
  id: string,
  { lock = false }: { lock?: boolean } = {}
): Promise<StoredCompetition | null> {
  const query = db.select().from(competition).where(eq(competition.id, id));
  const [row] = await (lock ? query.for("update") : query);
  if (!row) return null;

  const [groups, categories, keyDateRows] = await Promise.all([
    db
      .select()
      .from(competitionAgeGroup)
      .where(eq(competitionAgeGroup.competitionId, id))
      .orderBy(asc(competitionAgeGroup.position)),
    db
      .select({
        discipline: competitionCategory.discipline,
        ageGroupId: competitionCategory.ageGroupId,
      })
      .from(competitionCategory)
      .where(eq(competitionCategory.competitionId, id)),
    db
      .select({ kind: competitionKeyDate.kind, at: competitionKeyDate.at })
      .from(competitionKeyDate)
      .where(eq(competitionKeyDate.competitionId, id)),
  ]);

  const position = new Map(groups.map((group, index) => [group.id, index]));
  const keyDates: KeyDates = {};
  for (const { kind, at } of keyDateRows) keyDates[kind] = at;
  const disciplines = DISCIPLINES.filter((d) => row.disciplines.includes(d));

  return {
    row,
    values: {
      code: row.code,
      name: row.name,
      theme: row.theme,
      welfareMessage: row.welfareMessage,
      rules: row.rules,
      permittedMaterials: row.permittedMaterials,
      duration: row.duration,
      participation: row.participation,
      disciplines,
      ageGroups: groups.map(({ label, minAge, maxAge }) => ({
        label,
        minAge,
        maxAge,
      })),
      categories: categories
        .map((c) => ({
          discipline: c.discipline,
          group: position.get(c.ageGroupId)!,
        }))
        .sort(
          (a, b) =>
            DISCIPLINES.indexOf(a.discipline) -
              DISCIPLINES.indexOf(b.discipline) || a.group - b.group
        )
        .map(({ discipline, group }) => ({
          discipline,
          ageGroup: groups[group]!.label,
        })),
      ageCutoffDate: row.ageCutoffDate,
      digitalScope: row.digitalScope,
      shortlistPerCategory: row.shortlistPerCategory,
      schoolPositions: row.schoolPositions,
      physicalArtwork: physicalArtworkOf(row),
      publicDisplay: row.publicDisplay,
      auctionPermitted: row.auctionPermitted,
      keyDates,
    },
  };
}

/** The competition row's columns for these values. */
export function columnsOf(values: CompetitionValues) {
  const { physicalArtwork } = values;
  return {
    code: values.code,
    name: values.name,
    theme: values.theme,
    welfareMessage: values.welfareMessage,
    rules: values.rules,
    permittedMaterials: values.permittedMaterials,
    duration: values.duration,
    participation: values.participation,
    disciplines: values.disciplines,
    ageCutoffDate: values.ageCutoffDate,
    digitalScope: values.digitalScope,
    shortlistPerCategory: values.shortlistPerCategory,
    schoolPositions: values.schoolPositions,
    physicalArtwork: physicalArtwork.kind,
    physicalArtworkTopN:
      physicalArtwork.kind === "top_n" ? physicalArtwork.count : null,
    publicDisplay: values.publicDisplay,
    auctionPermitted: values.auctionPermitted,
  };
}

/**
 * Replaces the competition's age groups, categories and key dates with
 * these values' (the form saves them whole). New rows get new ids.
 */
export async function replaceGroups(
  tx: AppDb,
  competitionId: string,
  values: CompetitionValues,
  now: Date
): Promise<void> {
  // Deleting the age groups deletes their categories too.
  await tx
    .delete(competitionAgeGroup)
    .where(eq(competitionAgeGroup.competitionId, competitionId));
  await tx
    .delete(competitionKeyDate)
    .where(eq(competitionKeyDate.competitionId, competitionId));

  const groupIds = new Map<string, string>();
  if (values.ageGroups.length > 0) {
    await tx.insert(competitionAgeGroup).values(
      values.ageGroups.map((group, position) => {
        const id = uuidv7(now);
        groupIds.set(group.label, id);
        return { id, competitionId, position, ...group };
      })
    );
  }
  if (values.categories.length > 0) {
    await tx.insert(competitionCategory).values(
      values.categories.map(({ discipline, ageGroup }) => ({
        id: uuidv7(now),
        competitionId,
        discipline,
        ageGroupId: groupIds.get(ageGroup)!,
      }))
    );
  }
  const keyDates = orderedKeyDates(values.keyDates);
  if (keyDates.length > 0) {
    await tx
      .insert(competitionKeyDate)
      .values(keyDates.map(({ kind, at }) => ({ competitionId, kind, at })));
  }
}
