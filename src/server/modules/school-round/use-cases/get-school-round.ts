// getSchoolRound({ institutionId, reference }) (#89): the coordinator's
// school round page for one institution registration. Its status, the
// competition's shortlist size and school positions, the judging panel,
// each category's entries with what is picked, and what still stands in
// the way of finalising. `not_open` while the competition hasn't entered
// school judging (or the registration had no confirmed student then).
//
// Loads under plain Node: relative imports only, no "server-only".

import { eq } from "drizzle-orm";
import { z } from "zod";

import { authorize } from "../../../access/can";
import type { AppDb } from "../../../db/app-db";
import { competition, user } from "../../../db/schema";
import { invalidInput, type InvalidInput } from "../../../input";
import type { UseCaseContext } from "../../../use-cases";
import type {
  CompetitionStatus,
  Discipline,
} from "../../competitions/domain/vocabulary";
import type { EntryStatus } from "../../entries/domain/status";
import { isConductCertified } from "../../institution-submissions/conduct";
import {
  loadRegistrationScope,
  type RegistrationScope,
} from "../../institution-submissions/registration-scope";
import { institutionResource } from "../../institutions/coordinators/policy";
import { planFinalisation, type FinaliseBlocker } from "../domain/finalise";
import { availablePositions, type ShortlistLimits } from "../domain/picks";
import {
  isSchoolRoundEditable,
  type SchoolRoundStatus,
} from "../domain/status";
import {
  loadPanel,
  loadPicks,
  loadRound,
  loadRoundEntries,
  type PanelMember,
  type RoundEntry,
} from "../store";

export const roundInput = z.object({
  institutionId: z.uuid(),
  reference: z.string().max(40),
});

export type RoundEntryView = {
  entryId: string;
  code: string;
  title: string;
  studentName: string;
  status: EntryStatus;
  /** Only `submitted` entries can be picked. */
  submitted: boolean;
  picked: boolean;
  position: number | null;
};

export type RoundCategoryView = {
  id: string;
  discipline: Discipline;
  ageGroupLabel: string;
  entries: RoundEntryView[];
};

export type SchoolRoundView = {
  id: string;
  status: SchoolRoundStatus;
  reference: string;
  institutionName: string;
  competition: {
    id: string;
    code: string;
    name: string;
    status: CompetitionStatus;
    digitalScope: "all_participants" | "shortlist_only";
  };
  /** The competition's limits; `positions` is never above the shortlist size. */
  limits: ShortlistLimits;
  panel: PanelMember[];
  /** Categories that have entries, by discipline then age group. */
  categories: RoundCategoryView[];
  /** How many entries the round has in all, every status. */
  entryCount: number;
  conductCertified: boolean;
  /**
   * What stands in the way of finalising, apart from the attestation the
   * finalise form itself gives.
   */
  blockers: FinaliseBlocker[];
  /** Whether the panel and picks may still change. */
  canEdit: boolean;
  finalised: {
    at: Date;
    byName: string | null;
    statementVersion: string | null;
  } | null;
};

export type GetSchoolRoundResult =
  | { ok: true; round: SchoolRoundView }
  | InvalidInput
  | { ok: false; error: "not_found" | "not_open" };

/** The competition's shortlist limits, as finalising and picking use them. */
export async function limitsOf(
  db: AppDb,
  competitionId: string
): Promise<ShortlistLimits> {
  const [row] = await db
    .select({
      shortlistSize: competition.shortlistPerCategory,
      positions: competition.schoolPositions,
    })
    .from(competition)
    .where(eq(competition.id, competitionId));
  if (!row) throw new Error(`Competition ${competitionId} is gone`);
  // Publishing checks both (at least 1, and 0 or more).
  return { shortlistSize: row.shortlistSize, positions: row.positions };
}

/** Whether the round's panel and picks may change now. */
export function roundEditable(
  status: SchoolRoundStatus,
  competitionStatus: CompetitionStatus
): boolean {
  return (
    isSchoolRoundEditable(status) && competitionStatus === "school_judging"
  );
}

function categoriesOf(
  entries: readonly RoundEntry[],
  picks: ReadonlyMap<string, number | null>
): RoundCategoryView[] {
  const byId = new Map<string, RoundCategoryView>();
  for (const each of entries) {
    if (!each.categoryId) continue;
    let category = byId.get(each.categoryId);
    if (!category) {
      category = {
        id: each.categoryId,
        discipline: each.discipline,
        ageGroupLabel: each.ageGroupLabel ?? "",
        entries: [],
      };
      byId.set(each.categoryId, category);
    }
    category.entries.push({
      entryId: each.entryId,
      code: each.code,
      title: each.title,
      studentName: each.studentName,
      status: each.status,
      submitted: each.status === "submitted",
      picked: picks.has(each.entryId),
      position: picks.get(each.entryId) ?? null,
    });
  }
  return [...byId.values()].sort(
    (a, b) =>
      a.discipline.localeCompare(b.discipline) ||
      a.ageGroupLabel.localeCompare(b.ageGroupLabel, "en", { numeric: true })
  );
}

/** The page's view of a round, read in `db`. */
export async function roundView(
  db: AppDb,
  scope: RegistrationScope
): Promise<SchoolRoundView | null> {
  const round = await loadRound(db, scope.id);
  if (!round) return null;
  const [entries, panel, picks, conductCertified, limits] = [
    await loadRoundEntries(db, scope.id),
    await loadPanel(db, round.id),
    await loadPicks(db, round.id),
    await isConductCertified(db, scope.id),
    await limitsOf(db, round.competitionId),
  ];
  const plan = planFinalisation({
    panelSize: panel.length,
    conductCertified,
    judgingAttested: true,
    entries: entries.map((each) => ({
      entryId: each.entryId,
      submitted: each.status === "submitted",
    })),
    picks,
  });
  let finalisedByName: string | null = null;
  if (round.finalisedByUserId) {
    const [by] = await db
      .select({ name: user.name })
      .from(user)
      .where(eq(user.id, round.finalisedByUserId));
    finalisedByName = by?.name ?? null;
  }
  return {
    id: round.id,
    status: round.status,
    reference: scope.reference,
    institutionName: scope.institutionName,
    competition: scope.competition,
    limits: {
      shortlistSize: limits.shortlistSize,
      positions: availablePositions(limits),
    },
    panel,
    categories: categoriesOf(
      entries,
      new Map(picks.map((pick) => [pick.entryId, pick.position]))
    ),
    entryCount: entries.length,
    conductCertified,
    blockers: plan.ok ? [] : plan.blockers,
    canEdit: roundEditable(round.status, scope.competition.status),
    finalised: round.finalisedAt
      ? {
          at: round.finalisedAt,
          byName: finalisedByName,
          statementVersion: round.judgingStatementVersion,
        }
      : null,
  };
}

export async function getSchoolRound(
  ctx: UseCaseContext,
  input: { institutionId: string; reference: string }
): Promise<GetSchoolRoundResult> {
  const parsed = roundInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  await authorize(
    ctx,
    "school_round.read",
    institutionResource(parsed.data.institutionId)
  );
  const scope = await loadRegistrationScope(ctx.db, parsed.data);
  if (!scope) return { ok: false, error: "not_found" };
  const round = await roundView(ctx.db, scope);
  if (!round) return { ok: false, error: "not_open" };
  return { ok: true, round };
}
