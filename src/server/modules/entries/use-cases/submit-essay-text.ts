// submitEssayText({ registrationId, discipline?, title, description,
// statement?, essay }) (#86): an essay typed into the form rather than
// uploaded as a PDF. There is nothing to scan, so it counts at once (the
// owner's ruling on #86, 2026-11-19): its entry file is live, and the
// entry is submitted, as soon as it is saved inside the submission window.
//
// - The registration's first submission creates its entry, with its Entry
//   ID, already `submitted`, and sends the receipt (entry.submitted).
// - After a rejected or failed first file, typed text retries the entry:
//   `processing`, then `submitted` at once, and the receipt.
// - While the first upload (a PDF) is still being checked, typed text
//   takes its place: the upload is dropped, the entry is submitted.
// - On a submitted entry it replaces the live essay, typed or uploaded, at
//   once: the old file is superseded in the same transaction, the words
//   move onto the entry, and nothing is sent (as for any replacement).
//
// The text is checked as the form checks it (domain/essay-text.ts), then
// stored through the rich-text sanitiser's `essay` profile
// (src/server/rich-text/essay.ts): paragraphs of plain text, never HTML.
//
// Loads under plain Node: relative imports only, no "server-only".

import { eq } from "drizzle-orm";
import { z } from "zod";

import { authorize } from "../../../access/can";
import type { AppDb } from "../../../db/app-db";
import { entry, entryFile, participantProfile } from "../../../db/schema";
import { invalidInput, type InvalidInput } from "../../../input";
import { emit } from "../../../outbox/emit";
import { essayBodyFromText, essayBodyText } from "../../../rich-text/essay";
import type { UseCaseContext } from "../../../use-cases";
import {
  lockParticipationPins,
  participationRefusals,
} from "../../consent/participation-gate";
import { ENTRY_TEXT_LIMITS } from "../domain/entry-text";
import {
  checkEssayText,
  countWords,
  DEFAULT_ESSAY_RULE,
} from "../domain/essay-text";
import type { EntryStatus } from "../domain/status";
import { decideUpload } from "../domain/submission";
import {
  authorizeEntrySubmission,
  lockRegistrationStatus,
  submissionFacts,
} from "../registration-facts";
import { chooseDiscipline, formatOf } from "../rules";
import {
  lockEntryOfRegistration,
  nextEntryRowId,
  recordFileMove,
  recordMove,
  snapshotOf,
  supersedeEntryFiles,
} from "../store";
import { createEntry } from "./complete-entry-upload";

export type SubmitEssayTextInput = {
  registrationId: string;
  /** The essay discipline; fixed after the first submission. */
  discipline?: string;
  title: string;
  description: string;
  /** Optional: empty means none. */
  statement?: string;
  /** The essay as typed. */
  essay: string;
};

/** Why typed text can't be submitted, as the form names it. */
export type EssayTextRefusal =
  /** The school route takes digital work from the shortlist only (#91). */
  | "shortlist_only"
  | "registration_not_confirmed"
  | "participation_consent_required"
  | "discipline_not_offered"
  | "discipline_required"
  | "empty"
  | "too_many_words"
  | "too_long"
  | "submission_not_open"
  | "deadline_passed"
  | "entry_locked";

export type SubmitEssayTextResult =
  | { ok: true; entryCode: string; status: EntryStatus }
  | InvalidInput
  | { ok: false; error: EssayTextRefusal };

const words = (max: number) => z.string().trim().min(1).max(max);

export const submitEssayTextInput = z.object({
  registrationId: z.uuid().transform((id) => id.toLowerCase()),
  discipline: z.string().max(40).optional(),
  title: words(ENTRY_TEXT_LIMITS.title),
  description: words(ENTRY_TEXT_LIMITS.description),
  statement: z.string().trim().max(ENTRY_TEXT_LIMITS.statement).optional(),
  // Generous: the word and character limits are the essay rule's, and the
  // form shows them; this only bounds what a request may carry.
  essay: z.string().max(DEFAULT_ESSAY_RULE.maxChars * 4),
});

export async function submitEssayText(
  ctx: UseCaseContext,
  input: SubmitEssayTextInput
): Promise<SubmitEssayTextResult> {
  await authorize(ctx, "entry.access");
  const parsed = submitEssayTextInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const request = parsed.data;
  const submitter = await authorizeEntrySubmission(ctx, request.registrationId);
  if (submitter.scopeRefusal)
    return { ok: false, error: submitter.scopeRefusal };
  return ctx.db.transaction((tx) => record(tx, ctx, request));
}

async function record(
  tx: AppDb,
  ctx: UseCaseContext,
  request: z.infer<typeof submitEssayTextInput>
): Promise<SubmitEssayTextResult> {
  if (ctx.actor.kind !== "user") throw new Error("unreachable");
  const actor = ctx.actor;
  // Serialize with uploads, registration changes and consent withdrawal.
  await lockParticipationPins(tx, [request.registrationId]);
  const registered = await lockRegistrationStatus(tx, request.registrationId);
  if (registered !== "confirmed") {
    return { ok: false, error: "registration_not_confirmed" };
  }
  const { role: actorRole } = await authorizeEntrySubmission(
    { ...ctx, db: tx },
    request.registrationId
  );
  if (
    (await participationRefusals(tx, ctx, [request.registrationId])).size > 0
  ) {
    return { ok: false, error: "participation_consent_required" };
  }
  const facts = await submissionFacts(tx, request.registrationId);
  if (!facts) throw new Error("unreachable: locked registration has no facts");
  const current = await lockEntryOfRegistration(tx, request.registrationId);
  const chosen = chooseDiscipline({
    offered: facts.competition.disciplines,
    asked: request.discipline,
    current: current?.row.discipline,
  });
  if (!chosen.ok) return chosen;
  if (formatOf(chosen.discipline) !== "essay") {
    return { ok: false, error: "discipline_not_offered" };
  }
  const checked = checkEssayText(request.essay, DEFAULT_ESSAY_RULE);
  if (!checked.ok) return { ok: false, error: checked.reason };
  const body = essayBodyFromText(checked.text);
  const wordCount = countWords(essayBodyText(body));
  if (wordCount === 0) return { ok: false, error: "empty" };
  const window = facts.competition.window;
  if (!window) return { ok: false, error: "submission_not_open" };
  const now = ctx.clock.now();
  const decision = decideUpload({
    entry: current ? snapshotOf(current) : null,
    window,
    now,
  });
  if (!decision.ok) return { ok: false, error: decision.reason };

  const text = {
    title: request.title,
    description: request.description,
    statement: request.statement || null,
  };
  const [owner] = await tx
    .select({ kind: participantProfile.ownerKind })
    .from(participantProfile)
    .where(eq(participantProfile.id, facts.participantProfileId));
  const firstSubmission = current?.row.status !== "submitted";
  const entryFileId = nextEntryRowId(now);

  let entryId: string;
  let entryCode: string;
  if (!current) {
    const created = await createEntry(tx, now, {
      facts,
      discipline: chosen.discipline,
      text,
      userId: actor.userId,
      status: "submitted",
    });
    entryId = created.id;
    entryCode = created.code;
  } else {
    entryId = current.row.id;
    entryCode = current.row.code;
    // A typed essay replaces the live file at once, so it goes too.
    const dropped = current.files
      .filter(
        (file) => decision.supersede.includes(file.id) || file.status === "live"
      )
      .map((file) => file.id);
    await supersedeEntryFiles(tx, ctx, current.files, dropped, actorRole);
    await tx
      .update(entry)
      .set({
        ...text,
        status: "submitted",
        ...(firstSubmission ? { submittedAt: now } : {}),
        updatedAt: now,
      })
      .where(eq(entry.id, entryId));
  }

  await tx.insert(entryFile).values({
    id: entryFileId,
    entryId,
    attemptNumber: (current?.files.at(-1)?.attemptNumber ?? 0) + 1,
    kind: "text",
    fileAssetId: null,
    essayBody: body,
    wordCount,
    status: "live",
    receiptTitle:
      firstSubmission && owner?.kind === "self" ? text.title : undefined,
    uploadedByUserId: actor.userId,
    uploadCompletedAt: now,
    becameLiveAt: now,
    createdAt: now,
    updatedAt: now,
  });
  await recordFileMove(tx, ctx, {
    entryId,
    entryFileId,
    from: null,
    to: "live",
    actorRole,
  });

  // The entry's moves: created submitted; or a rejected or failed entry
  // retried (to processing), then submitted; or processing to submitted.
  let from: EntryStatus | null = current ? current.row.status : null;
  if (decision.action === "retry") {
    await recordMove(tx, ctx, {
      entryId,
      from,
      to: "processing",
      trigger: "upload_retried",
      entryFileId,
      actorRole,
    });
    from = "processing";
  }
  if (firstSubmission) {
    await recordMove(tx, ctx, {
      entryId,
      from,
      to: "submitted",
      trigger: "essay_typed",
      entryFileId,
      actorRole,
    });
    await emit(tx, ctx.clock, {
      type: "entry.submitted",
      aggregate: { type: "entry", id: entryId },
      payload: {
        entryId,
        entryFileId,
        registrationId: request.registrationId,
      },
    });
  }
  return { ok: true, entryCode, status: "submitted" };
}
