"use server";

// The upload island's Server Actions. Each one resolves the signed-in user
// and hands its input to one step in ./upload-steps.ts, which validates it
// and calls one Files use case (which checks can() itself).

import { as, currentActor } from "@/server/app";

import {
  completeUploadStep,
  fileStatusStep,
  requestUploadStep,
  SIGNED_OUT,
  type FileStatusView,
  type RequestUploadView,
} from "./upload-steps";

async function signedInUser() {
  const actor = await currentActor();
  return actor.kind === "user" ? actor : null;
}

/** Records a pending test upload and presigns its PUT. */
export async function requestUploadAction(
  input: unknown
): Promise<RequestUploadView> {
  const actor = await signedInUser();
  if (!actor) return SIGNED_OUT;
  return requestUploadStep(as(actor), input);
}

/** Confirms the PUT, which sends the file on to its scan. */
export async function completeUploadAction(
  input: unknown
): Promise<FileStatusView> {
  const actor = await signedInUser();
  if (!actor) return SIGNED_OUT;
  return completeUploadStep(as(actor), input);
}

/** Where the file's scan has got to. */
export async function fileStatusAction(
  input: unknown
): Promise<FileStatusView> {
  const actor = await signedInUser();
  if (!actor) return SIGNED_OUT;
  return fileStatusStep(as(actor), input);
}
