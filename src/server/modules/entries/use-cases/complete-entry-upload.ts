// completeEntryUpload({ registrationId, discipline?, fileId, title,
// description, statement? }) (#85, #86): the browser's PUT has finished;
// take the file (a picture, a video or an essay's PDF) and record it
// against the registration's entry.
//
// - The registration's first upload creates its entry in `processing`,
//   with its Entry ID ({comp}-E-{6}, from the codes module). There is no
//   draft: the words come with the file.
// - After a rejected or failed first file, an upload retries the entry
//   (back to `processing`).
// - Otherwise the upload is a pending replacement: the entry keeps its
//   status and its live file until the new one passes its checks. A newer
//   upload drops any still being checked.
// - The upload counts when it completes: it must complete inside the
//   submission window, and may be processed after it closes.
// - The Files module checks the stored object against what was declared
//   (its HEAD); the declaration is checked against the discipline's rule
//   again here.
//
// Completing the same upload again reports the entry as it stands.
//
// Loads under plain Node: relative imports only, no "server-only".

import { eq } from "drizzle-orm";
import { z } from "zod";

import { authorize } from "../../../access/can";
import type { AppDb } from "../../../db/app-db";
import {
  entry,
  entryFile,
  entryUploadGrant,
  registration,
} from "../../../db/schema";
import { uuidv7 } from "../../../ids";
import { invalidInput, type InvalidInput } from "../../../input";
import type { UseCaseContext } from "../../../use-cases";
import { withUniqueCode } from "../../codes/codes";
import type { Discipline } from "../../competitions/domain/vocabulary";
import {
  participationRefusals,
  lockParticipationPins,
} from "../../consent/participation-gate";
import {
  acceptPendingUpload,
  preparePendingUpload,
} from "../../files/use-cases/upload";
import { entryCodeFormat } from "../domain/entry-code";
import { ENTRY_TEXT_LIMITS, type EntryText } from "../domain/entry-text";
import type { EntryStatus } from "../domain/status";
import { decideUpload, type UploadDecision } from "../domain/submission";
import { checkUpload } from "../domain/upload-rules";
import { chooseDiscipline, uploadRuleFor } from "../rules";
import {
  authorizeEntrySubmission,
  lockRegistrationStatus,
  submissionFacts,
  type SubmissionFacts,
} from "../registration-facts";
import {
  entryFileOf,
  lockEntryOfRegistration,
  nextEntryRowId,
  recordFileMove,
  recordMove,
  snapshotOf,
  supersedeEntryFiles,
  type LockedEntry,
} from "../store";
import { lockEntryUpload, validUploadGrant } from "../upload-grants";
import {
  ENTRY_UPLOAD_PURPOSES,
  type EntryUploadRefusal,
} from "./start-entry-upload";

export type CompleteEntryUploadInput = {
  registrationId: string;
  discipline?: string;
  fileId: string;
  title: string;
  description: string;
  /** Optional: empty means none. */
  statement?: string;
};

export type CompleteEntryUploadResult =
  | { ok: true; entryCode: string; status: EntryStatus }
  | InvalidInput
  | {
      ok: false;
      error:
        | EntryUploadRefusal
        /** No upload of an entry file by this id. */
        | "file_not_found"
        /** Nothing in storage yet: PUT, then complete again. */
        | "upload_missing"
        /** Storage held something else than was declared; it was deleted. */
        | "upload_rejected";
    };

/** The constraint `withUniqueCode` retries on when an Entry ID is taken. */
export const ENTRY_CODE_UNIQUE = "entry_code_unique";

const words = (max: number) => z.string().trim().min(1).max(max);

export const completeEntryUploadInput = z.object({
  registrationId: z.uuid().transform((id) => id.toLowerCase()),
  discipline: z.string().max(40).optional(),
  fileId: z.uuid(),
  title: words(ENTRY_TEXT_LIMITS.title),
  description: words(ENTRY_TEXT_LIMITS.description),
  statement: z.string().trim().max(ENTRY_TEXT_LIMITS.statement).optional(),
});

type Parsed = z.infer<typeof completeEntryUploadInput>;

export async function completeEntryUpload(
  ctx: UseCaseContext,
  input: CompleteEntryUploadInput
): Promise<CompleteEntryUploadResult> {
  await authorize(ctx, "entry.access");
  const parsed = completeEntryUploadInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const request = parsed.data;
  const submitter = await authorizeEntrySubmission(ctx, request.registrationId);
  if (submitter.scopeRefusal)
    return { ok: false, error: submitter.scopeRefusal };
  const [registered] = await ctx.db
    .select({ status: registration.status })
    .from(registration)
    .where(eq(registration.id, request.registrationId));
  if (registered?.status !== "confirmed") {
    return { ok: false, error: "registration_not_confirmed" };
  }

  if (ctx.actor.kind !== "user") throw new Error("unreachable");
  const ownerId = ctx.actor.userId;
  // Take and check the bytes without holding the registration lock during
  // storage I/O. The file stays pending and will expire unless accepted.
  const found = await ctx.db.transaction((tx) =>
    prepareEntryUpload(tx, ctx, request, ownerId)
  );
  if (!found) return { ok: false, error: "file_not_found" };
  return ctx.db.transaction((tx) => record(tx, ctx, request));
}

async function prepareEntryUpload(
  tx: AppDb,
  ctx: UseCaseContext,
  request: Parsed,
  ownerId: string
): Promise<boolean> {
  const upload = await lockEntryUpload(tx, request.fileId, ownerId);
  if (!upload) return false;
  const { file, grant } = upload;
  if (file.status !== "pending_upload" || grant?.prepared) return true;
  if (!validUploadGrant(grant, request.registrationId, ctx.clock.now()))
    return true;
  const checked = await preparePendingUpload(ctx, tx, file);
  if (checked.ok) {
    await tx
      .update(entryUploadGrant)
      .set({ prepared: true })
      .where(eq(entryUploadGrant.fileAssetId, file.id));
  }
  return true;
}

async function record(
  tx: AppDb,
  ctx: UseCaseContext,
  request: Parsed
): Promise<CompleteEntryUploadResult> {
  if (ctx.actor.kind !== "user") throw new Error("unreachable");
  const actor = ctx.actor;
  // Serialize completions with each other, registration changes and consent withdrawal.
  await lockParticipationPins(tx, [request.registrationId]);
  const registered = await lockRegistrationStatus(tx, request.registrationId);
  if (registered !== "confirmed") {
    return { ok: false, error: "registration_not_confirmed" };
  }
  const { role: actorRole } = await authorizeEntrySubmission(
    { ...ctx, db: tx },
    request.registrationId
  );
  const current = await lockEntryOfRegistration(tx, request.registrationId);
  const upload = await lockEntryUpload(tx, request.fileId, actor.userId);
  if (!upload) return { ok: false, error: "file_not_found" };
  const { file } = upload;

  // Replay returns the attached entry even after the Files state changes or
  // the original grant expires.
  const attached = await entryFileOf(tx, file.id);
  if (attached) {
    return current && attached.entryId === current.row.id
      ? { ok: true, entryCode: current.row.code, status: current.row.status }
      : { ok: false, error: "file_not_found" };
  }
  if (
    (await participationRefusals(tx, ctx, [request.registrationId])).size > 0
  ) {
    return { ok: false, error: "participation_consent_required" };
  }
  const facts = await submissionFacts(tx, request.registrationId);
  if (!facts) throw new Error("unreachable: locked registration has no facts");
  const now = ctx.clock.now();
  const grant = validUploadGrant(upload.grant, request.registrationId, now);
  if (!grant) return { ok: false, error: "file_not_found" };
  const chosen = chooseDiscipline({
    offered: facts.competition.disciplines,
    asked: request.discipline,
    current: current?.row.discipline,
  });
  if (!chosen.ok) return chosen;
  const rule = uploadRuleFor(chosen.discipline)!;
  // A file started for another kind of work doesn't belong to this entry.
  if (file.purpose !== ENTRY_UPLOAD_PURPOSES[rule.kind]) {
    return { ok: false, error: "file_not_found" };
  }
  const check = checkUpload(
    { name: "", type: file.contentType, size: file.sizeBytes },
    rule
  );
  if (!check.ok) return { ok: false, error: check.reason };
  const window = facts.competition.window;
  if (!window) return { ok: false, error: "submission_not_open" };
  const decision = decideUpload({
    entry: current ? snapshotOf(current) : null,
    window,
    now,
  });
  if (!decision.ok) return { ok: false, error: decision.reason };
  if (file.status === "rejected")
    return { ok: false, error: "upload_rejected" };
  if (file.status !== "pending_upload")
    return { ok: false, error: "file_not_found" };
  if (!grant.prepared) return { ok: false, error: "upload_missing" };

  const text = {
    title: request.title,
    description: request.description,
    statement: request.statement || null,
  };
  const pendingText = current?.row.status === "submitted" ? text : null;
  const row = current
    ? await updateEntry(tx, now, current, decision, pendingText ? null : text)
    : await createEntry(tx, now, {
        facts,
        discipline: chosen.discipline,
        text,
        userId: actor.userId,
      });

  if (current) {
    await supersedeEntryFiles(
      tx,
      ctx,
      current.files,
      decision.supersede,
      actorRole
    );
  }
  const entryFileId = nextEntryRowId(now);
  await tx.insert(entryFile).values({
    id: entryFileId,
    entryId: row.id,
    attemptNumber: (current?.files.at(-1)?.attemptNumber ?? 0) + 1,
    kind: rule.kind,
    fileAssetId: file.id,
    status: "pending",
    pendingText,
    uploadedByUserId: actor.userId,
    uploadCompletedAt: now,
    createdAt: now,
    updatedAt: now,
  });

  await recordFileMove(tx, ctx, {
    entryId: row.id,
    entryFileId,
    from: null,
    to: "pending",
    actorRole,
  });
  if (decision.action !== "replace") {
    await recordMove(tx, ctx, {
      entryId: row.id,
      from: current ? current.row.status : null,
      to: "processing",
      trigger:
        decision.action === "create" ? "upload_completed" : "upload_retried",
      entryFileId,
      actorRole,
    });
  }

  // The scan can see this upload only after its entry file commits.
  await acceptPendingUpload(tx, ctx.clock, file);
  const status =
    decision.action === "replace" && current
      ? current.row.status
      : "processing";
  return { ok: true, entryCode: row.code, status };
}

/** Inserts the registration's entry with a fresh Entry ID. */
export async function createEntry(
  tx: AppDb,
  now: Date,
  {
    facts,
    discipline,
    text,
    userId,
    status = "processing",
  }: {
    facts: SubmissionFacts;
    discipline: Discipline;
    text: EntryText;
    userId: string;
    status?: "processing" | "submitted";
  }
) {
  const id = uuidv7(now);
  const code = await withUniqueCode(
    {
      format: entryCodeFormat(facts.competition.code),
      constraint: ENTRY_CODE_UNIQUE,
    },
    (candidate) =>
      tx.transaction(async (savepoint) => {
        await savepoint.insert(entry).values({
          id,
          code: candidate,
          competitionId: facts.competition.id,
          registrationId: facts.registrationId,
          participantProfileId: facts.participantProfileId,
          discipline,
          ...text,
          status,
          submittedAt: status === "submitted" ? now : null,
          createdByUserId: userId,
          createdAt: now,
          updatedAt: now,
        });
        return candidate;
      })
  );
  return { id, code };
}

async function updateEntry(
  tx: AppDb,
  now: Date,
  current: LockedEntry,
  decision: Extract<UploadDecision, { ok: true }>,
  text: EntryText | null
) {
  await tx
    .update(entry)
    .set({
      ...text,
      ...(decision.action === "retry" ? { status: "processing" as const } : {}),
      updatedAt: now,
    })
    .where(eq(entry.id, current.row.id));
  return { id: current.row.id, code: current.row.code };
}
