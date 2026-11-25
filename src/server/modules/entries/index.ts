// The entries module (#85, #86): a participant's work in a competition: a
// picture, a video or an essay. A confirmed individual registration has at
// most one entry, created with its first submission and its Entry ID; each
// upload is checked (scan, then derivatives: a picture's copies, a video's
// transcode and poster) before it counts, and a replacement stays pending
// until it passes. A typed essay has nothing to check and counts at once.
// Its use cases join `as(actor)` through `entriesUseCases`; the worker
// applies each file's outcome (./apply-file-outcome.ts).

import type { UseCaseContext } from "../../use-cases";
import {
  completeEntryUpload,
  type CompleteEntryUploadInput,
} from "./use-cases/complete-entry-upload";
import { getEntry } from "./use-cases/get-entry";
import { getEntryUploadOptions } from "./use-cases/get-entry-upload-options";
import { listCompetitionEntries } from "./use-cases/list-competition-entries";
import { listMyEntries } from "./use-cases/list-my-entries";
import {
  startEntryUpload,
  type StartEntryUploadInput,
} from "./use-cases/start-entry-upload";
import {
  submitEssayText,
  type SubmitEssayTextInput,
} from "./use-cases/submit-essay-text";

export type {
  CompleteEntryUploadInput,
  CompleteEntryUploadResult,
} from "./use-cases/complete-entry-upload";
export { completeEntryUploadInput } from "./use-cases/complete-entry-upload";
export type { MyEntry } from "./use-cases/list-my-entries";
export type { EntryDetail, GetEntryResult } from "./use-cases/get-entry";
export type { CompetitionEntry } from "./use-cases/list-competition-entries";
export type {
  EntryUploadRefusal,
  StartEntryUploadInput,
  StartEntryUploadResult,
} from "./use-cases/start-entry-upload";
export { startEntryUploadInput } from "./use-cases/start-entry-upload";
export type {
  EssayTextRefusal,
  SubmitEssayTextInput,
  SubmitEssayTextResult,
} from "./use-cases/submit-essay-text";
export { submitEssayTextInput } from "./use-cases/submit-essay-text";
export type { EntryStatus } from "./domain/status";

export const entriesUseCases = (ctx: UseCaseContext) => ({
  startEntryUpload: (input: StartEntryUploadInput) =>
    startEntryUpload(ctx, input),
  completeEntryUpload: (input: CompleteEntryUploadInput) =>
    completeEntryUpload(ctx, input),
  submitEssayText: (input: SubmitEssayTextInput) => submitEssayText(ctx, input),
  listMyEntries: () => listMyEntries(ctx),
  getEntry: (input: { code: string }) => getEntry(ctx, input),
  getEntryUploadOptions: (input: { registrationId: string }) =>
    getEntryUploadOptions(ctx, input),
  listCompetitionEntries: (input: { competitionId: string }) =>
    listCompetitionEntries(ctx, input),
});
