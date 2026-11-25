// The FOA judging module (#88): rubrics per discipline, and the guard that
// keeps a competition out of school judging until they are published. Its
// use cases join `as(actor)` through `judgingUseCases`.

import { assignmentUseCases } from "./assignment";
import { judgeUseCases } from "./judges";
import { roundUseCases } from "./rounds";
import type { UseCaseContext } from "../../use-cases";
import type { Discipline } from "../competitions/domain/vocabulary";
import type { RubricCriterion } from "./domain/rubric-criteria";
import { getJudgingGuide, listJudgingGuides } from "./judging-guide";
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
export type {
  GetJudgingGuideResult,
  GuideCompetition,
  JudgingGuideDiscipline,
} from "./judging-guide";
export type { RubricCriterion, RubricProblem } from "./domain/rubric-criteria";
export type { RubricStatus } from "./domain/rubric-status";
export { JUDGING_POLICY, type JudgingAction } from "./policy";

export const judgingUseCases = (ctx: UseCaseContext) => ({
  ...roundUseCases(ctx),
  ...judgeUseCases(ctx),
  ...assignmentUseCases(ctx),
  createRubricDraft: (input: {
    competitionId: string;
    discipline: Discipline;
  }) => createRubricDraft(ctx, input),
  updateRubricDraft: (input: {
    rubricId: string;
    criteria: RubricCriterion[];
  }) => updateRubricDraft(ctx, input),
  publishRubric: (input: { rubricId: string; criteria?: RubricCriterion[] }) =>
    publishRubric(ctx, input),
  startRubricRevision: (input: { rubricId: string }) =>
    startRubricRevision(ctx, input),
  listRubrics: (input: { competitionId: string }) => listRubrics(ctx, input),
  getDisciplineRubrics: (input: {
    competitionId: string;
    discipline: Discipline;
  }) => getDisciplineRubrics(ctx, input),
  getJudgingGuide: (input: { code: string }) => getJudgingGuide(ctx, input),
  listJudgingGuides: () => listJudgingGuides(ctx),
});
