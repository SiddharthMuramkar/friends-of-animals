"use server";

import { as, currentActor } from "@/server/app";
import {
  completeEntryUploadInput,
  startEntryUploadInput,
  submitEssayTextInput,
  type CompleteEntryUploadInput,
  type StartEntryUploadInput,
  type SubmitEssayTextInput,
} from "@/server/modules/entries";

import { forParticipant } from "./upload-action";

export async function startEntryUploadAction(input: StartEntryUploadInput) {
  return forParticipant(
    currentActor,
    as,
    startEntryUploadInput,
    input,
    (app, data) => app.startEntryUpload(data)
  );
}

export async function completeEntryUploadAction(
  input: CompleteEntryUploadInput
) {
  return forParticipant(
    currentActor,
    as,
    completeEntryUploadInput,
    input,
    (app, data) => app.completeEntryUpload(data)
  );
}

/** A typed essay (#86): no upload, so one action does it all. */
export async function submitEssayTextAction(input: SubmitEssayTextInput) {
  return forParticipant(
    currentActor,
    as,
    submitEssayTextInput,
    input,
    (app, data) => app.submitEssayText(data)
  );
}
