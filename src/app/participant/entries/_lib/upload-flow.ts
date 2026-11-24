// The entry form's upload (../_components/entry-upload-form.tsx), apart
// from React and the network so it is tested on its own: ask for a grant,
// PUT the file straight to storage with exactly the signed headers, then
// complete. What the form remembers between submits is `memory`, so the
// next submit picks up where the last one stopped:
//
// - the same file is PUT again only if storage never got it, and after a
//   lost completion answer it is only completed again (completing twice
//   finds the first result);
// - a different file replaces the grant the form holds;
// - a fresh form, or one whose grant request got no answer, asks the
//   server to restart the uploader's pending grant. The server may have
//   made that grant, and retired the one it replaced, before the answer
//   was lost; the registration has one outstanding grant at a time, so
//   naming the retired one again would be refused until the new one
//   expired.
//
// It never rejects: a step that does is the "unknown" error.

import { putHeaders } from "@/app/account/files/_lib/upload";
import type {
  CompleteEntryUploadInput,
  CompleteEntryUploadResult,
  StartEntryUploadInput,
  StartEntryUploadResult,
} from "@/server/modules/entries";

import type { ParticipantActionResult } from "./upload-action";

export type StartAnswer = ParticipantActionResult<StartEntryUploadResult>;
export type CompleteAnswer = ParticipantActionResult<CompleteEntryUploadResult>;

/** Every error the form can show. */
export type EntryUploadError = Extract<
  StartAnswer | CompleteAnswer,
  { ok: false }
>["error"];

/** How the flow reaches the server and storage; the form passes the real ones. */
export type EntryUploadSteps = {
  /** The Server Actions (./actions.ts). */
  start(input: StartEntryUploadInput): Promise<StartAnswer>;
  complete(input: CompleteEntryUploadInput): Promise<CompleteAnswer>;
  /** The browser's PUT of `body` to a signed URL: true if storage took it. */
  put(
    url: string,
    body: Blob,
    headers: Record<string, string>
  ): Promise<boolean>;
};

type Grant = Extract<StartAnswer, { ok: true }>;

/** The file the form holds a grant for, and whether storage has it. */
export type UploadAttempt = { file: Blob; grant: Grant; uploaded: boolean };

/** Kept by the form across submits; a fresh form starts with null. */
export type UploadMemory = { attempt: UploadAttempt | null };

export type EntryUploadRequest = {
  registrationId: string;
  discipline: string;
  file: File;
  title: string;
  description: string;
  statement: string;
};

export type EntryUploadOutcome =
  | { ok: true; entryCode: string }
  | { ok: false; error: EntryUploadError };

export async function runEntryUpload(
  memory: UploadMemory,
  { file, title, description, statement, ...target }: EntryUploadRequest,
  steps: EntryUploadSteps
): Promise<EntryUploadOutcome> {
  let attempt = memory.attempt;
  if (attempt?.file !== file) {
    let grant: StartAnswer;
    try {
      grant = await steps.start({
        ...target,
        file: { name: file.name, type: file.type, size: file.size },
        replacesFileId: attempt?.grant.fileId,
        restartPendingUpload: attempt === null,
      });
    } catch {
      // No answer: whatever grant the server made, the next try restarts.
      memory.attempt = null;
      return { ok: false, error: "unknown" };
    }
    if (!grant.ok) return { ok: false, error: grant.error };
    attempt = { file, grant, uploaded: false };
    memory.attempt = attempt;
  }

  const { grant } = attempt;
  if (!attempt.uploaded) {
    attempt.uploaded = await steps
      .put(grant.uploadUrl, file, putHeaders(grant.headers))
      .catch(() => false);
  }
  // Completion also tells us whether a PUT whose answer was lost arrived,
  // or the grant expired while we were trying to upload.
  let completed: CompleteAnswer;
  try {
    completed = await steps.complete({
      ...target,
      fileId: grant.fileId,
      title,
      description,
      statement,
    });
  } catch {
    return { ok: false, error: "unknown" };
  }
  if (completed.ok) return { ok: true, entryCode: completed.entryCode };
  if (completed.error === "upload_missing") attempt.uploaded = false;
  if (
    completed.error === "file_not_found" ||
    completed.error === "upload_rejected"
  ) {
    memory.attempt = null;
  }
  return { ok: false, error: completed.error };
}
