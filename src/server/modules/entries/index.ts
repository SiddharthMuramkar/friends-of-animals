// The entries module (#85): a participant's work in a competition. A
// confirmed individual registration has at most one entry, created with its
// first upload and its Entry ID; each upload is checked (scan, then
// derivatives) before it counts, and a replacement stays pending until it
// passes. Its use cases join `as(actor)` through `entriesUseCases`; the
// worker applies each file's outcome (./apply-file-outcome.ts).

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
export type { EntryStatus } from "./domain/status";

export const entriesUseCases = (ctx: UseCaseContext) => ({
  startEntryUpload: (input: StartEntryUploadInput) =>
    startEntryUpload(ctx, input),
  completeEntryUpload: (input: CompleteEntryUploadInput) =>
    completeEntryUpload(ctx, input),
  listMyEntries: () => listMyEntries(ctx),
  getEntry: (input: { code: string }) => getEntry(ctx, input),
  getEntryUploadOptions: (input: { registrationId: string }) =>
    getEntryUploadOptions(ctx, input),
  listCompetitionEntries: (input: { competitionId: string }) =>
    listCompetitionEntries(ctx, input),
});
