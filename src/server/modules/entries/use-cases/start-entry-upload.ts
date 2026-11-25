// startEntryUpload({ registrationId, discipline?, file }) (#85, #86): the
// first step of submitting, replacing or retrying an entry's file: a
// picture, a video or an essay's PDF, as the discipline takes. The
// participant or their verified guardian, or on the school route the
// student's coordinator (#87), asks to upload one file,
// described as the browser sees it (with a video's length when the browser
// could read it); the server checks it against the discipline's rule (the
// same check the form runs), the registration and the submission window,
// then presigns a private upload under the Files module's purpose for that
// kind of file (`entry_image`, `entry_video`, `entry_document`). Nothing
// about the entry changes until completeEntryUpload.
//
// Loads under plain Node: relative imports only, no "server-only".

import { z } from "zod";

import { authorize } from "../../../access/can";
import { invalidInput, type InvalidInput } from "../../../input";
import type { UseCaseContext } from "../../../use-cases";
import {
  participationRefusals,
  lockParticipationPins,
} from "../../consent/participation-gate";
import type { EntryFilePurpose } from "../../files/domain/purposes";
import { checkUpload, type UploadKind } from "../domain/upload-rules";
import { decideUpload } from "../domain/submission";
import { chooseDiscipline, uploadRuleFor } from "../rules";
import {
  authorizeEntrySubmission,
  lockRegistrationStatus,
  submissionFacts,
} from "../registration-facts";
import { lockEntryOfRegistration, snapshotOf } from "../store";
import { issueEntryUploadGrant, lockUploader } from "../issue-upload-grant";

export type StartEntryUploadInput = {
  registrationId: string;
  /** One of the competition's disciplines; fixed after the first submission. */
  discipline?: string;
  /**
   * The chosen file as the browser describes it, with a video's length in
   * milliseconds when the browser could read it (#86).
   */
  file: {
    name: string;
    type: string;
    size: number;
    durationMs?: number | null | undefined;
  };
  /** A pending grant for an earlier file selection by this uploader. */
  replacesFileId?: string | undefined;
  /** A fresh form can restart this uploader's pending grant. */
  restartPendingUpload?: boolean;
};

/** Why an upload can't go ahead, as the form names it. */
export type EntryUploadRefusal =
  /** The school route takes digital work from the shortlist only (#87, #91). */
  | "shortlist_only"
  | "registration_not_confirmed"
  | "participation_consent_required"
  | "discipline_not_offered"
  | "discipline_required"
  | "empty"
  | "wrong_type"
  | "too_large"
  | "too_long"
  | "submission_not_open"
  | "deadline_passed"
  | "entry_locked"
  | "upload_limit";

export type StartEntryUploadResult =
  | {
      ok: true;
      fileId: string;
      /** PUT the file here, with `headers`, before `expiresAt`. */
      uploadUrl: string;
      headers: Record<string, string>;
      expiresAt: Date;
    }
  | InvalidInput
  | { ok: false; error: EntryUploadRefusal };

export const startEntryUploadInput = z.object({
  registrationId: z.uuid().transform((id) => id.toLowerCase()),
  replacesFileId: z.uuid().optional(),
  restartPendingUpload: z.boolean().optional(),
  discipline: z.string().max(40).optional(),
  file: z.object({
    name: z.string().max(255),
    type: z.string().max(255),
    size: z.number().int().min(0),
    durationMs: z.number().min(0).max(Number.MAX_SAFE_INTEGER).nullish(),
  }),
});

/** The Files module's purpose for each kind of entry file. */
export const ENTRY_UPLOAD_PURPOSES = {
  image: "entry_image",
  video: "entry_video",
  document: "entry_document",
} as const satisfies Record<UploadKind, EntryFilePurpose>;

export async function startEntryUpload(
  ctx: UseCaseContext,
  input: StartEntryUploadInput
): Promise<StartEntryUploadResult> {
  await authorize(ctx, "entry.access");
  const parsed = startEntryUploadInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const {
    registrationId,
    discipline,
    file,
    replacesFileId,
    restartPendingUpload,
  } = parsed.data;
  const submitter = await authorizeEntrySubmission(ctx, registrationId);
  if (submitter.scopeRefusal)
    return { ok: false, error: submitter.scopeRefusal };
  if (ctx.actor.kind !== "user") throw new Error("unreachable");
  const ownerId = ctx.actor.userId;

  return ctx.db.transaction(async (tx): Promise<StartEntryUploadResult> => {
    await lockParticipationPins(tx, [registrationId]);
    await lockUploader(tx, ownerId);
    const status = await lockRegistrationStatus(tx, registrationId);
    if (status !== "confirmed") {
      return { ok: false, error: "registration_not_confirmed" };
    }
    await authorizeEntrySubmission({ ...ctx, db: tx }, registrationId);
    if ((await participationRefusals(tx, ctx, [registrationId])).size > 0) {
      return { ok: false, error: "participation_consent_required" };
    }
    const facts = await submissionFacts(tx, registrationId);
    if (!facts)
      throw new Error("unreachable: locked registration has no facts");
    const current = await lockEntryOfRegistration(tx, registrationId);
    const chosen = chooseDiscipline({
      offered: facts.competition.disciplines,
      asked: discipline,
      current: current?.row.discipline,
    });
    if (!chosen.ok) return chosen;
    const rule = uploadRuleFor(chosen.discipline)!;
    const check = checkUpload(file, rule);
    if (!check.ok) return { ok: false, error: check.reason };
    const window = facts.competition.window;
    if (!window) return { ok: false, error: "submission_not_open" };
    const decision = decideUpload({
      entry: current ? snapshotOf(current) : null,
      window,
      now: ctx.clock.now(),
    });
    if (!decision.ok) return { ok: false, error: decision.reason };

    return issueEntryUploadGrant(ctx, tx, {
      ownerId,
      registrationId,
      uploader: submitter.whose === "student" ? "coordinator" : "participant",
      purpose: ENTRY_UPLOAD_PURPOSES[rule.kind],
      contentType: check.contentType,
      sizeBytes: file.size,
      replacesFileId,
      restartPendingUpload,
    });
  });
}
