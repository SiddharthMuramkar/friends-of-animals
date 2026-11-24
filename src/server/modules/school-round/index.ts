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

import type { UseCaseContext } from "../../use-cases";
import { getSchoolRound } from "./use-cases/get-school-round";

export type {
  GetSchoolRoundResult,
  RoundCategoryView,
  RoundEntryView,
  SchoolRoundView,
} from "./use-cases/get-school-round";
export type { FinaliseBlocker } from "./domain/finalise";
export type { SchoolRoundStatus } from "./domain/status";

type RegistrationRef = { institutionId: string; reference: string };

export const schoolRoundUseCases = (ctx: UseCaseContext) => ({
  getSchoolRound: (input: RegistrationRef) => getSchoolRound(ctx, input),
});
