// The category of an entry is its discipline and the age group on the
// registration. The blind module receives only the age-group label; the
// identity-bearing registration table never crosses its boundary.
import { eq, inArray } from "drizzle-orm";
import type { AppDb } from "../../db/app-db";
import { competitionAgeGroup, entry, registration } from "../../db/schema";
export async function entryAgeGroupLabels(db: AppDb, entryIds: string[]) {
  if (!entryIds.length) return new Map<string, string | null>();
  const rows = await db
    .select({ entryId: entry.id, ageGroupLabel: competitionAgeGroup.label })
    .from(entry)
    .innerJoin(registration, eq(registration.id, entry.registrationId))
    .leftJoin(
      competitionAgeGroup,
      eq(competitionAgeGroup.id, registration.ageGroupId)
    )
    .where(inArray(entry.id, entryIds));
  return new Map(rows.map((row) => [row.entryId, row.ageGroupLabel]));
}
