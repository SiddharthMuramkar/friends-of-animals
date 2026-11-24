"use server";

import { as, currentActor } from "@/server/app";
import {
  completeEntryUploadInput,
  startEntryUploadInput,
  type CompleteEntryUploadInput,
  type StartEntryUploadInput,
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
