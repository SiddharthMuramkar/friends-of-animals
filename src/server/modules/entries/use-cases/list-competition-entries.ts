// listCompetitionEntries({ competitionId }) (#85): the entries staff may see
// in one competition, for its competition managers (scoped to it, or
// global). An entry shows only once a file of it has passed the scan and
// processing: never while it is `processing`, `rejected` or `failed`. It is
// a blind list: the Entry ID, the title and the discipline, never who made
// the work.
//
// Loads under plain Node: relative imports only, no "server-only".

import { and, asc, eq, notInArray } from "drizzle-orm";
import { z } from "zod";

import { authorize } from "../../../access/can";
import { entry } from "../../../db/schema";
import { invalidInput, type InvalidInput } from "../../../input";
import type { UseCaseContext } from "../../../use-cases";
import type { Discipline } from "../../competitions/domain/vocabulary";
import type { EntryStatus } from "../domain/status";

export type CompetitionEntry = {
  code: string;
  title: string;
  discipline: Discipline;
  status: EntryStatus;
  submittedAt: Date | null;
};

/** The statuses of an entry that has never had a live file. */
const HIDDEN: EntryStatus[] = ["processing", "rejected", "failed"];

const listInput = z.object({ competitionId: z.uuid() });

export async function listCompetitionEntries(
  ctx: UseCaseContext,
  input: { competitionId: string }
): Promise<CompetitionEntry[] | InvalidInput> {
  const requestedId = input?.competitionId;
  await authorize(ctx, "entry.list_competition", {
    scopes:
      typeof requestedId === "string"
        ? [{ type: "competition", id: requestedId }]
        : [],
  });
  const parsed = listInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const { competitionId } = parsed.data;
  return ctx.db
    .select({
      code: entry.code,
      title: entry.title,
      discipline: entry.discipline,
      status: entry.status,
      submittedAt: entry.submittedAt,
    })
    .from(entry)
    .where(
      and(
        eq(entry.competitionId, competitionId),
        notInArray(entry.status, HIDDEN)
      )
    )
    .orderBy(asc(entry.submittedAt), asc(entry.code));
}
