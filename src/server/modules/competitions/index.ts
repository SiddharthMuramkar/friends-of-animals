// The competitions module (#70): competition managers create, edit,
// preview and publish competitions; the public pages read the published
// ones. Its use cases join `as(actor)` through `competitionsUseCases`.

import type { UseCaseContext } from "../../use-cases";
import type { CompetitionInput } from "./fields";
import {
  createCompetition,
  getCompetitionForEdit,
  listCompetitionsForAdmin,
  updateCompetition,
  type UpdateCompetitionInput,
} from "./manage";
import { previewCompetition, publishCompetition } from "./publish";
import {
  getPublishedCompetition,
  listPublishedCompetitions,
  publishedCompetitionSlugs,
} from "./read-model";

export { COMPETITION_TAGS } from "./cache-tags";
export type { KeyDateKind } from "./domain/key-dates";
export type { PublishProblem } from "./domain/publish-rules";
export type {
  CompetitionStatus,
  DigitalScope,
  Discipline,
  Participation,
  PhysicalArtwork,
} from "./domain/vocabulary";
export type { CompetitionFields, CompetitionInput } from "./fields";
export type {
  AdminCompetitionListItem,
  CompetitionForEdit,
  CompetitionSummary,
  CreateCompetitionResult,
  GetCompetitionForEditResult,
  UpdateCompetitionInput,
  UpdateCompetitionResult,
} from "./manage";
export type {
  PreviewCompetitionResult,
  PublishCompetitionResult,
} from "./publish";
export type { PublicCompetition } from "./public-view";
export type { PublishedCompetition } from "./read-model";

export const competitionsUseCases = (ctx: UseCaseContext) => ({
  createCompetition: (input: CompetitionInput) => createCompetition(ctx, input),
  getCompetitionForEdit: (input: { competitionId: string }) =>
    getCompetitionForEdit(ctx, input),
  updateCompetition: (input: UpdateCompetitionInput) =>
    updateCompetition(ctx, input),
  listCompetitionsForAdmin: () => listCompetitionsForAdmin(ctx),
  previewCompetition: (input: { competitionId: string }) =>
    previewCompetition(ctx, input),
  publishCompetition: (input: { competitionId: string }) =>
    publishCompetition(ctx, input),
  listPublishedCompetitions: () => listPublishedCompetitions(ctx),
  getPublishedCompetition: (input: { slug: string }) =>
    getPublishedCompetition(ctx, input),
  publishedCompetitionSlugs: () => publishedCompetitionSlugs(ctx),
});
