// The competitions module (#70): competition managers create, edit,
// preview and publish competitions; the public pages read the published
// ones. Its use cases join `as(actor)` through `competitionsUseCases`.

import type { UseCaseContext } from "../../use-cases";
import type { CompetitionInput } from "./fields";
import {
  createCompetition,
  getCompetitionForEdit,
  updateCompetition,
  type UpdateCompetitionInput,
} from "./manage";

export type { CompetitionFields, CompetitionInput } from "./fields";
export type {
  CompetitionForEdit,
  CompetitionSummary,
  CreateCompetitionResult,
  GetCompetitionForEditResult,
  UpdateCompetitionInput,
  UpdateCompetitionResult,
} from "./manage";

export const competitionsUseCases = (ctx: UseCaseContext) => ({
  createCompetition: (input: CompetitionInput) => createCompetition(ctx, input),
  getCompetitionForEdit: (input: { competitionId: string }) =>
    getCompetitionForEdit(ctx, input),
  updateCompetition: (input: UpdateCompetitionInput) =>
    updateCompetition(ctx, input),
});
