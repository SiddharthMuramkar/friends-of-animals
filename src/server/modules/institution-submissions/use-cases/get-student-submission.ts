// getStudentSubmission({ institutionId, reference, registrationNumber })
// (#87): one student's page on the coordinator's roster. The student (by
// name and registration number), their entry if there is one (its Entry
// ID, status, words, the live picture through a short-lived signed URL,
// and where the newest upload stands), and the upload the coordinator can
// make now (first, retry or replacement, in which disciplines), or why
// not. The upload itself goes through the entries module's use cases,
// which check all of it again.
//
// A registration number outside this institution registration, like a
// reference of another institution, finds nothing.
//
// Loads under plain Node: relative imports only, no "server-only".

import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { authorize } from "../../../access/can";
import {
  entry,
  entryFile,
  participantProfile,
  registration,
} from "../../../db/schema";
import { invalidInput, type InvalidInput } from "../../../input";
import type { UseCaseContext } from "../../../use-cases";
import type { Discipline } from "../../competitions/domain/vocabulary";
import type { EntryFileStatus, EntryStatus } from "../../entries/domain/status";
import { decideUpload } from "../../entries/domain/submission";
import {
  submissionFacts,
  submissionWindows,
} from "../../entries/registration-facts";
import { isImageDiscipline, isEntryDiscipline } from "../../entries/rules";
import { moduleDerivativeUrl } from "../../files/use-cases/derivative-url";
import { institutionResource } from "../../institutions/coordinators/policy";
import { latestVerification } from "../../verification/store";
import { submissionGate, type RosterHold } from "../domain/roster";
import { loadRegistrationScope } from "../registration-scope";

export type StudentSubmissionHold =
  | RosterHold
  | "entry_locked"
  | "discipline_not_offered";

export type StudentSubmission = {
  ok: true;
  reference: string;
  institutionName: string;
  competitionName: string;
  closesAt: Date | null;
  student: {
    registrationId: string;
    name: string;
    registrationNumber: string;
  };
  entry: {
    id: string;
    correction: {
      reasonCode: string;
      reasonText: string | null;
      dueAt: Date;
    } | null;
    code: string;
    status: EntryStatus;
    title: string;
    description: string;
    statement: string | null;
    discipline: Discipline;
    submittedAt: Date | null;
    /** The live file's large copy; null until one is live. */
    picture: { url: string; width: number; height: number } | null;
    /** Where the newest upload stands, unless it is the live one. */
    latestUpload: Extract<
      EntryFileStatus,
      "pending" | "processing" | "rejected" | "failed"
    > | null;
  } | null;
  /** The upload the coordinator can make now; null when `hold` says why not. */
  upload: {
    mode: "submit" | "retry" | "replace";
    disciplines: Discipline[];
  } | null;
  hold: StudentSubmissionHold | null;
};

export type GetStudentSubmissionResult =
  | StudentSubmission
  | InvalidInput
  | { ok: false; error: "not_found" };

const studentInput = z.object({
  institutionId: z.uuid(),
  reference: z.string().max(40),
  registrationNumber: z
    .string()
    .trim()
    .max(40)
    .transform((value) => value.toUpperCase()),
});

const LATEST: Partial<
  Record<
    EntryFileStatus,
    NonNullable<StudentSubmission["entry"]>["latestUpload"]
  >
> = {
  pending: "pending",
  processing: "processing",
  rejected: "rejected",
  failed: "failed",
};

export async function getStudentSubmission(
  ctx: UseCaseContext,
  input: {
    institutionId: string;
    reference: string;
    registrationNumber: string;
  }
): Promise<GetStudentSubmissionResult> {
  const parsed = studentInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const { institutionId, reference, registrationNumber } = parsed.data;
  await authorize(
    ctx,
    "institution_submissions.read",
    institutionResource(institutionId)
  );
  const scope = await loadRegistrationScope(ctx.db, {
    institutionId,
    reference,
  });
  if (!scope) return { ok: false, error: "not_found" };
  const [student] = await ctx.db
    .select({
      registrationId: registration.id,
      name: participantProfile.fullName,
      registrationNumber: registration.registrationNumber,
      status: registration.status,
    })
    .from(registration)
    .innerJoin(
      participantProfile,
      eq(participantProfile.id, registration.participantProfileId)
    )
    .where(
      and(
        eq(registration.institutionRegistrationId, scope.id),
        eq(registration.registrationNumber, registrationNumber)
      )
    );
  if (!student?.registrationNumber) return { ok: false, error: "not_found" };

  const newest = ctx.db
    .select({ status: entryFile.status })
    .from(entryFile)
    .where(eq(entryFile.entryId, entry.id))
    .orderBy(desc(entryFile.attemptNumber))
    .limit(1)
    .as("newest");
  const [row] = await ctx.db
    .select({
      id: entry.id,
      code: entry.code,
      status: entry.status,
      title: entry.title,
      description: entry.description,
      statement: entry.statement,
      discipline: entry.discipline,
      submittedAt: entry.submittedAt,
      liveAssetId: entryFile.fileAssetId,
      newestStatus: newest.status,
    })
    .from(entry)
    .leftJoin(
      entryFile,
      and(eq(entryFile.entryId, entry.id), eq(entryFile.status, "live"))
    )
    .leftJoinLateral(newest, sql`true`)
    .where(eq(entry.registrationId, student.registrationId));
  const picture = row?.liveAssetId
    ? await moduleDerivativeUrl(ctx, row.liveAssetId, "display_1600")
    : null;

  const window =
    (await submissionWindows(ctx.db, [scope.competition.id])).get(
      scope.competition.id
    ) ?? null;
  const now = ctx.clock.now();
  const latest =
    row?.status === "sent_back"
      ? await latestVerification(ctx.db, row.id)
      : null;
  const correction =
    latest?.reasonCode && latest.resubmissionDueAt
      ? {
          reasonCode: latest.reasonCode,
          reasonText: latest.reasonText,
          dueAt: latest.resubmissionDueAt,
        }
      : null;
  const gate = correction
    ? now < correction.dueAt
      ? "open"
      : "deadline_passed"
    : submissionGate(scope.competition.digitalScope, window, now);
  const offered = row
    ? [row.discipline].filter(
        correction ? isEntryDiscipline : isImageDiscipline
      )
    : (
        (await submissionFacts(ctx.db, student.registrationId))?.competition
          .disciplines ?? []
      ).filter(isImageDiscipline);
  const decision =
    window && row
      ? decideUpload({
          entry: { status: row.status, files: [] },
          window,
          now,
          resubmissionDueAt: correction?.dueAt ?? null,
        })
      : null;
  const hold: StudentSubmissionHold | null =
    student.status !== "confirmed"
      ? "registration_not_confirmed"
      : gate !== "open"
        ? gate
        : decision && !decision.ok
          ? "entry_locked"
          : offered.length === 0
            ? "discipline_not_offered"
            : null;

  return {
    ok: true,
    reference: scope.reference,
    institutionName: scope.institutionName,
    competitionName: scope.competition.name,
    closesAt: correction?.dueAt ?? window?.closesAt ?? null,
    student: {
      registrationId: student.registrationId,
      name: student.name,
      registrationNumber: student.registrationNumber,
    },
    entry: row
      ? {
          id: row.id,
          correction,
          code: row.code,
          status: row.status,
          title: row.title,
          description: row.description,
          statement: row.statement,
          discipline: row.discipline,
          submittedAt: row.submittedAt,
          picture: picture
            ? { url: picture.url, width: picture.width, height: picture.height }
            : null,
          latestUpload: row.newestStatus
            ? (LATEST[row.newestStatus] ?? null)
            : null,
        }
      : null,
    upload: hold
      ? null
      : {
          mode: !row
            ? "submit"
            : row.status === "rejected" || row.status === "failed"
              ? "retry"
              : "replace",
          disciplines: offered,
        },
    hold,
  };
}
