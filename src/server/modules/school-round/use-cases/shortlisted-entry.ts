// startShortlistedEntry and completeShortlistedEntry (#91): under the
// shortlist-only digital submission scope students upload nothing. The
// school judges the physical work, and in the open school round the
// coordinator creates an entry for each shortlisted student: a photo or
// scan of the work with its title, description, optional school position
// and the declarations (../domain/shortlist-only.ts). The two steps are the
// participant's upload's (grant → PUT → complete): start checks the
// student, the file and that the category has room, and presigns; complete
// checks it all again with the round locked, then creates the entry
// already school-shortlisted, with its Entry ID, its pick and its
// declarations. The file goes through the usual scan and processing; the
// entry goes on to FOA once that file is live and the round is finished
// (../promote-shortlisted-entry.ts).
//
// Uploading again for a student replaces the photo: while the round is
// open, and afterwards for an entry whose upload failed (owner decision of
// 2026-11-19: a failed upload leaves it school_shortlisted until the
// coordinator uploads again), keeping its pick as it was.
//
// Loads under plain Node: relative imports only, no "server-only".

import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { authorize } from "../../../access/can";
import type { Role } from "../../../access/domain/roles";
import type { AppDb } from "../../../db/app-db";
import {
  competitionCategory,
  registration,
  schoolRound,
  schoolRoundDeclaration,
  schoolRoundPick,
  type SchoolRoundRow,
} from "../../../db/schema";
import { invalidInput, type InvalidInput } from "../../../input";
import type { UseCaseContext } from "../../../use-cases";
import type { Discipline } from "../../competitions/domain/vocabulary";
import { ENTRY_TEXT_LIMITS } from "../../entries/domain/entry-text";
import { checkUpload } from "../../entries/domain/upload-rules";
import {
  issueEntryUploadGrant,
  lockUploader,
} from "../../entries/issue-upload-grant";
import {
  lockRegistrationStatus,
  submissionFacts,
} from "../../entries/registration-facts";
import { chooseDiscipline, uploadRuleFor } from "../../entries/rules";
import { recordShortlistedUpload } from "../../entries/shortlisted-entry";
import {
  entryFileOf,
  lockEntryOfRegistration,
  type LockedEntry,
} from "../../entries/store";
import { lockEntryUpload, validUploadGrant } from "../../entries/upload-grants";
import {
  ENTRY_UPLOAD_PURPOSES,
  startEntryUploadInput,
} from "../../entries/use-cases/start-entry-upload";
import { prepareEntryUpload } from "../../entries/use-cases/complete-entry-upload";
import {
  loadRegistrationScope,
  type RegistrationScope,
} from "../../institution-submissions/registration-scope";
import { institutionResource } from "../../institutions/coordinators/policy";
import { checkCategoryPicks, type PickProblem } from "../domain/picks";
import {
  checkShortlistOnlyDeclarations,
  SHORTLIST_ONLY_DECLARATIONS_VERSION,
  type ShortlistOnlyDeclaration,
} from "../domain/shortlist-only";
import { isSchoolRoundFinished } from "../domain/status";
import { loadPicks, loadRound, loadRoundEntries } from "../store";
import { limitsOf, roundEditable, roundInput } from "./get-school-round";

/** Why a shortlisted entry can't be made or uploaded now. */
export type ShortlistedEntryRefusal =
  /** No such registration at this institution. */
  | "not_found"
  /** The competition takes every participant's work, not the shortlist's. */
  | "not_shortlist_only"
  /** The school round hasn't opened yet. */
  | "not_open"
  /** The round is finished, or the competition left school judging. */
  | "round_not_editable"
  /** Not a student of this institution registration. */
  | "student_not_found"
  | "registration_not_confirmed"
  /** The student's entry has gone on from the school round. */
  | "entry_locked"
  | "discipline_not_offered"
  | "discipline_required"
  | "empty"
  | "wrong_type"
  | "too_large"
  | "too_long"
  | "upload_limit";

export type ShortlistedEntryProblem =
  | { ok: false; error: ShortlistedEntryRefusal }
  /** The category's shortlist would break its limits; each problem named. */
  | { ok: false; error: "shortlist_invalid"; problems: PickProblem[] };

export const startShortlistedEntryInput = roundInput.extend(
  startEntryUploadInput.shape
);

export type StartShortlistedEntryInput = z.input<
  typeof startShortlistedEntryInput
>;

export type StartShortlistedEntryResult =
  | {
      ok: true;
      fileId: string;
      /** PUT the file here, with `headers`, before `expiresAt`. */
      uploadUrl: string;
      headers: Record<string, string>;
      expiresAt: Date;
    }
  | InvalidInput
  | ShortlistedEntryProblem;

const words = (max: number) => z.string().trim().min(1).max(max);

export const completeShortlistedEntryInput = roundInput.extend({
  registrationId: z.uuid().transform((id) => id.toLowerCase()),
  discipline: z.string().max(40).optional(),
  fileId: z.uuid(),
  title: words(ENTRY_TEXT_LIMITS.title),
  description: words(ENTRY_TEXT_LIMITS.description),
  statement: z.string().trim().max(ENTRY_TEXT_LIMITS.statement).optional(),
  /** The school position, or null for none. */
  position: z.int().min(-1000).max(1000).nullable(),
  /** The declarations ticked: every one is required. */
  declarations: z.array(z.string().max(60)).max(20),
});

export type CompleteShortlistedEntryInput = z.input<
  typeof completeShortlistedEntryInput
>;

export type CompleteShortlistedEntryResult =
  | { ok: true; entryCode: string; status: "school_shortlisted" }
  | InvalidInput
  | ShortlistedEntryProblem
  | {
      ok: false;
      error: "declarations_invalid";
      missing: ShortlistOnlyDeclaration[];
      unknown: string[];
    }
  | {
      ok: false;
      error:
        /** No upload of an entry file by this id. */
        | "file_not_found"
        /** Nothing in storage yet: PUT, then complete again. */
        | "upload_missing"
        /** Storage held something else than was declared; it was deleted. */
        | "upload_rejected";
    };

type OpenStudent = {
  scope: RegistrationScope;
  round: SchoolRoundRow;
  current: LockedEntry | null;
  /** The round is open: picks may change. Otherwise only a re-upload. */
  editable: boolean;
  ageGroupId: string | null;
};

/**
 * Locks the registration's round, the student's registration and entry,
 * and says whether a shortlisted entry may be made or uploaded for them.
 */
async function openStudent(
  tx: AppDb,
  ref: { institutionId: string; reference: string },
  registrationId: string
): Promise<OpenStudent | { ok: false; error: ShortlistedEntryRefusal }> {
  const scope = await loadRegistrationScope(tx, ref, { lock: true });
  if (!scope) return { ok: false, error: "not_found" };
  if (scope.competition.digitalScope !== "shortlist_only") {
    return { ok: false, error: "not_shortlist_only" };
  }
  const round = await loadRound(tx, scope.id, { lock: true });
  if (!round) return { ok: false, error: "not_open" };
  const [student] = await tx
    .select({ ageGroupId: registration.ageGroupId })
    .from(registration)
    .where(
      and(
        eq(registration.id, registrationId),
        eq(registration.institutionRegistrationId, scope.id),
        eq(registration.route, "institution")
      )
    );
  if (!student) return { ok: false, error: "student_not_found" };
  if ((await lockRegistrationStatus(tx, registrationId)) !== "confirmed") {
    return { ok: false, error: "registration_not_confirmed" };
  }
  const current = await lockEntryOfRegistration(tx, registrationId);
  if (current && current.row.status !== "school_shortlisted") {
    return { ok: false, error: "entry_locked" };
  }
  const editable = roundEditable(round.status, scope.competition.status);
  const needsFile =
    current !== null && !current.files.some((file) => file.status === "live");
  if (
    !editable &&
    !(
      needsFile &&
      isSchoolRoundFinished(round.status) &&
      (scope.competition.status === "school_judging" ||
        scope.competition.status === "foa_judging")
    )
  ) {
    return { ok: false, error: "round_not_editable" };
  }
  return { scope, round, current, editable, ageGroupId: student.ageGroupId };
}

/** The entry being made, before it has an id. */
const NEW_ENTRY = "00000000-0000-7000-8000-000000000000";

/**
 * Checks the category's shortlist with this student's entry in it at
 * `position` (its saved one if undefined); returns its category.
 */
async function checkRoom(
  tx: AppDb,
  open: OpenStudent,
  discipline: Discipline,
  position: number | null | undefined
): Promise<
  | { ok: true; categoryId: string; position: number | null }
  | ShortlistedEntryProblem
> {
  const [category] = open.ageGroupId
    ? await tx
        .select({ id: competitionCategory.id })
        .from(competitionCategory)
        .where(
          and(
            eq(competitionCategory.competitionId, open.round.competitionId),
            eq(competitionCategory.discipline, discipline),
            eq(competitionCategory.ageGroupId, open.ageGroupId)
          )
        )
    : [];
  if (!category) return { ok: false, error: "discipline_not_offered" };
  const self = open.current?.row.id ?? NEW_ENTRY;
  const picks = await loadPicks(tx, open.round.id);
  const saved = picks.find((pick) => pick.entryId === self);
  const mine = position === undefined ? (saved?.position ?? null) : position;
  const entries = await loadRoundEntries(tx, open.scope.id, { lock: true });
  const check = checkCategoryPicks({
    categoryId: category.id,
    candidates: [
      ...entries
        .filter((each) => each.entryId !== self)
        .map((each) => ({
          entryId: each.entryId,
          categoryId: each.categoryId ?? "",
          submitted: each.status === "school_shortlisted",
        })),
      { entryId: self, categoryId: category.id, submitted: true },
    ],
    picks: [
      ...picks
        .filter(
          (pick) => pick.categoryId === category.id && pick.entryId !== self
        )
        .map(({ entryId, position }) => ({ entryId, position })),
      { entryId: self, position: mine },
    ],
    limits: await limitsOf(tx, open.round.competitionId),
  });
  if (!check.ok) {
    return { ok: false, error: "shortlist_invalid", problems: check.problems };
  }
  return { ok: true, categoryId: category.id, position: mine };
}

export async function startShortlistedEntry(
  ctx: UseCaseContext,
  input: StartShortlistedEntryInput
): Promise<StartShortlistedEntryResult> {
  const parsed = startShortlistedEntryInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const { institutionId, reference, registrationId, discipline, file } =
    parsed.data;
  await authorize(
    ctx,
    "school_round.manage",
    institutionResource(institutionId)
  );
  if (ctx.actor.kind !== "user") throw new Error("unreachable");
  const ownerId = ctx.actor.userId;
  return ctx.db.transaction(
    async (tx): Promise<StartShortlistedEntryResult> => {
      await lockUploader(tx, ownerId);
      const open = await openStudent(
        tx,
        { institutionId, reference },
        registrationId
      );
      if ("ok" in open) return open;
      const facts = await submissionFacts(tx, registrationId);
      if (!facts) throw new Error("unreachable: locked registration is gone");
      const chosen = chooseDiscipline({
        offered: facts.competition.disciplines,
        asked: discipline,
        current: open.current?.row.discipline,
      });
      if (!chosen.ok) return chosen;
      const rule = uploadRuleFor(chosen.discipline)!;
      const check = checkUpload(file, rule);
      if (!check.ok) return { ok: false, error: check.reason };
      if (open.editable) {
        const room = await checkRoom(tx, open, chosen.discipline, undefined);
        if (!room.ok) return room;
      }
      return issueEntryUploadGrant(ctx, tx, {
        ownerId,
        registrationId,
        uploader: "coordinator",
        purpose: ENTRY_UPLOAD_PURPOSES[rule.kind],
        contentType: check.contentType,
        sizeBytes: file.size,
        replacesFileId: parsed.data.replacesFileId,
        restartPendingUpload: parsed.data.restartPendingUpload,
      });
    }
  );
}

export async function completeShortlistedEntry(
  ctx: UseCaseContext,
  input: CompleteShortlistedEntryInput
): Promise<CompleteShortlistedEntryResult> {
  const parsed = completeShortlistedEntryInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const request = parsed.data;
  const { role } = await authorize(
    ctx,
    "school_round.manage",
    institutionResource(request.institutionId)
  );
  if (ctx.actor.kind !== "user") throw new Error("unreachable");
  const userId = ctx.actor.userId;
  // Take and check the bytes without holding the round's lock during
  // storage I/O. The file stays pending and expires unless accepted.
  const found = await ctx.db.transaction((tx) =>
    prepareEntryUpload(tx, ctx, request, userId)
  );
  if (!found) return { ok: false, error: "file_not_found" };
  return ctx.db.transaction((tx) => record(tx, ctx, request, userId, role));
}

async function record(
  tx: AppDb,
  ctx: UseCaseContext,
  request: z.infer<typeof completeShortlistedEntryInput>,
  userId: string,
  role: Role | null
): Promise<CompleteShortlistedEntryResult> {
  const open = await openStudent(tx, request, request.registrationId);
  if ("ok" in open) return open;
  const upload = await lockEntryUpload(tx, request.fileId, userId);
  if (!upload) return { ok: false, error: "file_not_found" };
  const { file } = upload;
  // Completing again reports the entry as it stands.
  const attached = await entryFileOf(tx, file.id);
  if (attached) {
    return open.current && attached.entryId === open.current.row.id
      ? {
          ok: true,
          entryCode: open.current.row.code,
          status: "school_shortlisted",
        }
      : { ok: false, error: "file_not_found" };
  }
  const now = ctx.clock.now();
  const grant = validUploadGrant(upload.grant, request.registrationId, now);
  if (!grant) return { ok: false, error: "file_not_found" };
  const facts = await submissionFacts(tx, request.registrationId);
  if (!facts) throw new Error("unreachable: locked registration is gone");
  const chosen = chooseDiscipline({
    offered: facts.competition.disciplines,
    asked: request.discipline,
    current: open.current?.row.discipline,
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
  const declared = checkShortlistOnlyDeclarations(request.declarations);
  if (!declared.ok) {
    return {
      ok: false,
      error: "declarations_invalid",
      missing: declared.missing,
      unknown: declared.unknown,
    };
  }
  const room = open.editable
    ? await checkRoom(tx, open, chosen.discipline, request.position)
    : null;
  if (room && !room.ok) return room;
  if (file.status === "rejected")
    return { ok: false, error: "upload_rejected" };
  if (file.status !== "pending_upload") {
    return { ok: false, error: "file_not_found" };
  }
  if (!grant.prepared) return { ok: false, error: "upload_missing" };

  const row = await recordShortlistedUpload(tx, ctx, {
    facts,
    current: open.current,
    discipline: chosen.discipline,
    kind: rule.kind,
    file,
    text: {
      title: request.title,
      description: request.description,
      statement: request.statement || null,
    },
    userId,
    actorRole: role,
  });
  if (room) {
    await tx.delete(schoolRoundPick).where(eq(schoolRoundPick.entryId, row.id));
    await tx.insert(schoolRoundPick).values({
      entryId: row.id,
      roundId: open.round.id,
      categoryId: room.categoryId,
      position: room.position,
      pickedByUserId: userId,
      pickedAt: now,
    });
  }
  const declaration = {
    declarations: declared.declarations,
    statementVersion: SHORTLIST_ONLY_DECLARATIONS_VERSION,
    declaredByUserId: userId,
    declaredAt: now,
  };
  await tx
    .insert(schoolRoundDeclaration)
    .values({ entryId: row.id, roundId: open.round.id, ...declaration })
    .onConflictDoUpdate({
      target: schoolRoundDeclaration.entryId,
      set: declaration,
    });
  await tx
    .update(schoolRound)
    .set({ updatedAt: now })
    .where(eq(schoolRound.id, open.round.id));
  return { ok: true, entryCode: row.code, status: "school_shortlisted" };
}
