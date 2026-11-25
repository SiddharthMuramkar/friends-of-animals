// The school round module (#89). When a competition enters school judging,
// each confirmed institution registration gets an open round. From the
// round's page a coordinator records the judging panel, picks a shortlist
// per category (with optional school positions), attests the judging and
// finalises. Finalising is the only thing that emits
// `school_round.shortlist_finalised`: it moves each entry to
// school-shortlisted (and on to FOA under all-participants scope) or not
// shortlisted, and each family is told which. Overdue rounds, closing on
// the school's behalf and reopening come with #90; the shortlist-only
// scope with #91. Its use cases join `as(actor)` through
// `schoolRoundUseCases`.

import {
  closeSchoolRoundOnBehalf,
  reopenSchoolRound,
  listSchoolRoundsForManager,
  type ManageRoundInput,
  type CloseSchoolRoundInput,
} from "./use-cases/manage-round";
import type { UseCaseContext } from "../../use-cases";
import {
  finaliseSchoolRound,
  type FinaliseSchoolRoundInput,
} from "./use-cases/finalise-school-round";
import { getSchoolRound } from "./use-cases/get-school-round";
import {
  listSchoolRoundOutcomes,
  type ListSchoolRoundOutcomesInput,
} from "./use-cases/list-school-round-outcomes";
import { recordPanel, type RecordPanelInput } from "./use-cases/record-panel";
import {
  saveShortlist,
  type SaveShortlistInput,
} from "./use-cases/save-shortlist";

export type {
  GetSchoolRoundResult,
  RoundCategoryView,
  RoundEntryView,
  SchoolRoundView,
} from "./use-cases/get-school-round";
export type { RecordPanelResult } from "./use-cases/record-panel";
export { PANEL_FIELD_MAX, PANEL_MAX_MEMBERS } from "./use-cases/record-panel";
export type { SaveShortlistResult } from "./use-cases/save-shortlist";
export type { PickProblem } from "./domain/picks";
export type { FinaliseSchoolRoundResult } from "./use-cases/finalise-school-round";
export type {
  ListSchoolRoundOutcomesResult,
  SchoolRoundOutcome,
} from "./use-cases/list-school-round-outcomes";
export { JUDGING_STATEMENT_VERSION } from "./domain/judging-statement";
export type { FinaliseBlocker } from "./domain/finalise";
export type { SchoolRoundStatus } from "./domain/status";

type RegistrationRef = { institutionId: string; reference: string };

export const schoolRoundUseCases = (ctx: UseCaseContext) => ({
  listSchoolRoundsForManager: (input: { competitionId: string }) =>
    listSchoolRoundsForManager(ctx, input),
  closeSchoolRoundOnBehalf: (input: CloseSchoolRoundInput) =>
    closeSchoolRoundOnBehalf(ctx, input),
  reopenSchoolRound: (input: ManageRoundInput) => reopenSchoolRound(ctx, input),
  getSchoolRound: (input: RegistrationRef) => getSchoolRound(ctx, input),
  recordPanel: (input: RecordPanelInput) => recordPanel(ctx, input),
  saveShortlist: (input: SaveShortlistInput) => saveShortlist(ctx, input),
  finaliseSchoolRound: (input: FinaliseSchoolRoundInput) =>
    finaliseSchoolRound(ctx, input),
  listSchoolRoundOutcomes: (input: ListSchoolRoundOutcomesInput) =>
    listSchoolRoundOutcomes(ctx, input),
});
