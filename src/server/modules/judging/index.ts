// The FOA judging module (#88): rubrics per discipline, and the guard that
// keeps a competition out of school judging until they are published. Its
// use cases join `as(actor)` through `judgingUseCases`.

import type { UseCaseContext } from "../../use-cases";
import type { Discipline } from "../competitions/domain/vocabulary";
import type { RubricCriterion } from "./domain/rubric-criteria";
import {
  createRubricDraft,
  getDisciplineRubrics,
  listRubrics,
  publishRubric,
  startRubricRevision,
  updateRubricDraft,
} from "./rubrics";

export type {
  CompetitionSummary,
  CreateRubricDraftResult,
  DisciplineRubricState,
  GetDisciplineRubricsResult,
  ListRubricsResult,
  SchoolJudgingBlock,
  PublishRubricResult,
  RubricView,
  StartRubricRevisionResult,
  UpdateRubricDraftResult,
} from "./rubrics";
export type { RubricCriterion, RubricProblem } from "./domain/rubric-criteria";
export type { RubricStatus } from "./domain/rubric-status";
export { JUDGING_POLICY, type JudgingAction } from "./policy";

export const judgingUseCases = (ctx: UseCaseContext) => ({
  createRubricDraft: (input: {
    competitionId: string;
    discipline: Discipline;
  }) => createRubricDraft(ctx, input),
  updateRubricDraft: (input: {
    rubricId: string;
    criteria: RubricCriterion[];
  }) => updateRubricDraft(ctx, input),
  publishRubric: (input: { rubricId: string }) => publishRubric(ctx, input),
  startRubricRevision: (input: { rubricId: string }) =>
    startRubricRevision(ctx, input),
  listRubrics: (input: { competitionId: string }) => listRubrics(ctx, input),
  getDisciplineRubrics: (input: {
    competitionId: string;
    discipline: Discipline;
  }) => getDisciplineRubrics(ctx, input),
});
