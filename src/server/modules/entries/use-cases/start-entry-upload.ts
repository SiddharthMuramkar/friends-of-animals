// startEntryUpload({ registrationId, discipline?, file }) (#85): the first
// step of submitting, replacing or retrying an entry's picture. The
// participant or their verified guardian asks to
// upload one file, described as the browser sees it; the server checks it
// against the discipline's rule (the same check the form runs), the
// registration and the submission window, then presigns a private upload
// under the Files module's `entry_image` purpose. Nothing about the entry
// changes until completeEntryUpload.
//
// Loads under plain Node: relative imports only, no "server-only".

import { eq } from "drizzle-orm";
import { z } from "zod";

import { authorize } from "../../../access/can";
import { entryUploadGrant, user } from "../../../db/schema";
import { invalidInput, type InvalidInput } from "../../../input";
import type { UseCaseContext } from "../../../use-cases";
import {
  participationRefusals,
  lockParticipationPins,
} from "../../consent/participation-gate";
import { uploadKeyFor } from "../../files/domain/storage-key";
import { presignUpload } from "../../files/use-cases/upload";
import { checkUpload } from "../domain/upload-rules";
import { decideUpload } from "../domain/submission";
import { chooseDiscipline, uploadRuleFor } from "../rules";
import {
  authorizeEntrySubmission,
  lockRegistrationStatus,
  submissionFacts,
} from "../registration-facts";
import { lockEntryOfRegistration, snapshotOf } from "../store";
import {
  canIssueUploadGrant,
  lockEntryImage,
  pendingUploadFileId,
  scheduleUploadGrantCleanup,
  validUploadGrant,
} from "../upload-grants";

export type StartEntryUploadInput = {
  registrationId: string;
  /** One of the competition's picture disciplines; fixed after the first upload. */
  discipline?: string;
  /** The chosen file as the browser describes it. */
  file: { name: string; type: string; size: number };
  /** A pending grant for an earlier file selection by this uploader. */
  replacesFileId?: string | undefined;
  /** A fresh form can restart this uploader's pending grant. */
  restartPendingUpload?: boolean;
};

/** Why an upload can't go ahead, as the form names it. */
export type EntryUploadRefusal =
  | "registration_not_confirmed"
  | "participation_consent_required"
  | "discipline_not_offered"
  | "discipline_required"
  | "empty"
  | "wrong_type"
  | "too_large"
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
  }),
});

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
  await authorizeEntrySubmission(ctx, registrationId);
  if (ctx.actor.kind !== "user") throw new Error("unreachable");
  const ownerId = ctx.actor.userId;

  return ctx.db.transaction(async (tx): Promise<StartEntryUploadResult> => {
    await lockParticipationPins(tx, [registrationId]);
    // Serializes one actor's grant requests even across registrations.
    await tx
      .select({ id: user.id })
      .from(user)
      .where(eq(user.id, ownerId))
      .for("no key update");
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
    const check = checkUpload(file, uploadRuleFor(chosen.discipline)!);
    if (!check.ok) return { ok: false, error: check.reason };
    const window = facts.competition.window;
    if (!window) return { ok: false, error: "submission_not_open" };
    const now = ctx.clock.now();
    const decision = decideUpload({
      entry: current ? snapshotOf(current) : null,
      window,
      now,
    });
    if (!decision.ok) return { ok: false, error: decision.reason };

    const previousFileId =
      replacesFileId ??
      (restartPendingUpload
        ? await pendingUploadFileId(tx, ownerId, registrationId, now)
        : undefined);
    const previous = previousFileId
      ? await lockEntryImage(tx, previousFileId, ownerId)
      : null;
    const retiringFileId =
      previous?.file.status === "pending_upload" &&
      validUploadGrant(previous.grant, registrationId, now)
        ? previous.file.id
        : undefined;
    if (
      !(await canIssueUploadGrant(tx, {
        ownerId,
        registrationId,
        now,
        retiringFileId,
      }))
    ) {
      return { ok: false, error: "upload_limit" };
    }
    if (retiringFileId) {
      await tx
        .update(entryUploadGrant)
        .set({ retired: true })
        .where(eq(entryUploadGrant.fileAssetId, retiringFileId));
    }

    const presigned = await presignUpload(ctx, tx, {
      purpose: "entry_image",
      contentType: check.contentType,
      sizeBytes: file.size,
    });
    if (!presigned.ok) {
      // The rule above is narrower than the purpose's, so this is a bug.
      throw new Error(
        `The entry_image purpose refused an upload: ${presigned.error}`
      );
    }
    const { fileId, expiresAt } = presigned;
    await tx.insert(entryUploadGrant).values({
      fileAssetId: fileId,
      registrationId,
      uploadKey: uploadKeyFor({ prefix: ctx.files.keyPrefix, fileId }),
      expiresAt,
    });
    await scheduleUploadGrantCleanup(tx, ctx.clock, { fileId, expiresAt });
    return presigned;
  });
}
