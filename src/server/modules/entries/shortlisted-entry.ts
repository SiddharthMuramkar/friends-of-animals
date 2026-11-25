// A shortlisted entry's upload (#91), for the school round module, inside
// its transaction with the round, the registration and the entry locked.
// Under shortlist-only scope the coordinator creates the entry in the
// school round: the first upload inserts it already `school_shortlisted`,
// with its Entry ID; a later one (after a failed file, or to replace the
// photo) supersedes any upload still being checked and waits to replace the
// live file, while the entry keeps its status. No upload outcome moves the
// entry (./domain/submission.ts treats every one as a replacement's): it
// goes on to FOA by the school round's promotion.
//
// Loads under plain Node: relative imports only.

import { eq } from "drizzle-orm";

import type { Role } from "../../access/domain/roles";
import type { Actor } from "../../actor";
import type { AppDb } from "../../db/app-db";
import { entry, entryFile, type FileAssetRow } from "../../db/schema";
import type { Clock } from "../../ports/clock";
import type { Discipline } from "../competitions/domain/vocabulary";
import { acceptPendingUpload } from "../files/use-cases/upload";
import type { EntryText } from "./domain/entry-text";
import type { UploadKind } from "./domain/upload-rules";
import type { SubmissionFacts } from "./registration-facts";
import {
  nextEntryRowId,
  recordFileMove,
  recordMove,
  supersedeEntryFiles,
  type LockedEntry,
} from "./store";
import { createEntry } from "./use-cases/complete-entry-upload";

const IN_FLIGHT = new Set(["pending", "processing"]);

/** Records the upload against the registration's shortlisted entry. */
export async function recordShortlistedUpload(
  tx: AppDb,
  ctx: { clock: Clock; actor: Actor },
  upload: {
    facts: SubmissionFacts;
    /** The registration's entry, locked; null for its first upload. */
    current: LockedEntry | null;
    discipline: Discipline;
    kind: UploadKind;
    file: FileAssetRow;
    text: EntryText;
    userId: string;
    actorRole: Role | null;
  }
): Promise<{ id: string; code: string }> {
  const now = ctx.clock.now();
  const { current } = upload;
  let row: { id: string; code: string };
  if (current) {
    row = { id: current.row.id, code: current.row.code };
    await supersedeEntryFiles(
      tx,
      ctx,
      current.files,
      current.files
        .filter((file) => IN_FLIGHT.has(file.status))
        .map((file) => file.id),
      upload.actorRole
    );
    await tx
      .update(entry)
      .set({ ...upload.text, updatedAt: now })
      .where(eq(entry.id, row.id));
  } else {
    row = await createEntry(tx, now, {
      facts: upload.facts,
      discipline: upload.discipline,
      text: upload.text,
      userId: upload.userId,
      status: "school_shortlisted",
    });
  }

  const entryFileId = nextEntryRowId(now);
  await tx.insert(entryFile).values({
    id: entryFileId,
    entryId: row.id,
    attemptNumber: (current?.files.at(-1)?.attemptNumber ?? 0) + 1,
    kind: upload.kind,
    fileAssetId: upload.file.id,
    status: "pending",
    uploadedByUserId: upload.userId,
    uploadCompletedAt: now,
    createdAt: now,
    updatedAt: now,
  });
  await recordFileMove(tx, ctx, {
    entryId: row.id,
    entryFileId,
    from: null,
    to: "pending",
    actorRole: upload.actorRole,
  });
  if (!current) {
    await recordMove(tx, ctx, {
      entryId: row.id,
      from: null,
      to: "school_shortlisted",
      trigger: "shortlisted_entry_created",
      entryFileId,
      actorRole: upload.actorRole,
    });
  }
  // The scan can see this upload only after its entry file commits.
  await acceptPendingUpload(tx, ctx.clock, upload.file);
  return row;
}
