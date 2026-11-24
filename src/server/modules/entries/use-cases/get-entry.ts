// getEntry({ code }) (#85): one entry's page, for the participant it
// belongs to, a teen with their own login, or the child's guardian. It
// shows the entry's live picture (its large derivative, through a
// short-lived signed URL) until a replacement has passed its checks, where
// the latest upload stands, and whether a new upload can go ahead now.
//
// Somebody else's entry, or a code that names none, is refused the same
// way (forbidden), so nothing about another participant leaks.
//
// Loads under plain Node: relative imports only, no "server-only".

import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { authorize } from "../../../access/can";
import {
  competition,
  entry,
  entryFile,
  participantProfile,
  registration,
} from "../../../db/schema";
import { DomainError } from "../../../errors";
import { invalidInput, type InvalidInput } from "../../../input";
import type { UseCaseContext } from "../../../use-cases";
import type { Discipline } from "../../competitions/domain/vocabulary";
import { participationRefusals } from "../../consent/participation-gate";
import { moduleDerivativeUrl } from "../../files/use-cases/derivative-url";
import { visibleProfiles } from "../../participants/list-my-registrations";
import { parseEntryCode } from "../domain/entry-code";
import type { EntryFileStatus, EntryStatus } from "../domain/status";
import { decideUpload, type SubmissionWindow } from "../domain/submission";
import type { UploadRule } from "../domain/upload-rules";
import { submissionWindows } from "../registration-facts";
import { uploadRuleFor } from "../rules";

export type EntryDetail = {
  code: string;
  status: EntryStatus;
  title: string;
  description: string;
  statement: string | null;
  discipline: Discipline;
  competition: { name: string; slug: string };
  /** When submissions close; null while the competition has no such date. */
  closesAt: Date | null;
  registrationId: string;
  participantName: string;
  whose: "mine" | "child";
  submittedAt: Date | null;
  /** The live file's large copy; null until one is live. */
  picture: { url: string; width: number; height: number } | null;
  /** Where the newest upload stands, unless it is the live one. */
  latestUpload: Extract<
    EntryFileStatus,
    "pending" | "processing" | "rejected" | "failed"
  > | null;
  /**
   * The rule a new upload must meet when the individual submission is open
   * to the viewer; else null.
   */
  uploadRule: UploadRule | null;
};

export type GetEntryResult = { ok: true; entry: EntryDetail } | InvalidInput;

const getEntryInput = z.object({ code: z.string().max(40) });

/** What a file's status says about the newest upload, as the page shows it. */
const LATEST: Partial<Record<EntryFileStatus, EntryDetail["latestUpload"]>> = {
  pending: "pending",
  processing: "processing",
  rejected: "rejected",
  failed: "failed",
};

export async function getEntry(
  ctx: UseCaseContext,
  input: { code: string }
): Promise<GetEntryResult> {
  await authorize(ctx, "entry.access");
  const parsed = getEntryInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const code = parseEntryCode(parsed.data.code);
  const [scope] =
    code && ctx.actor.kind === "user"
      ? await ctx.db
          .select({ profileId: entry.participantProfileId })
          .from(entry)
          .where(eq(entry.code, code))
      : [];
  const visible =
    ctx.actor.kind === "user" && scope
      ? (await visibleProfiles(ctx.db, ctx.actor.userId)).get(scope.profileId)
      : undefined;
  await authorize(
    ctx,
    "entry.read",
    visible && ctx.actor.kind === "user" ? { ownerId: ctx.actor.userId } : {}
  );
  if (!code || !scope || !visible) {
    throw new Error("unreachable: authorized for no entry");
  }

  // Read the published text and picture together so a promotion cannot
  // pair the previous text with the new file.
  const newest = ctx.db
    .select({ status: entryFile.status })
    .from(entryFile)
    .where(eq(entryFile.entryId, entry.id))
    .orderBy(desc(entryFile.attemptNumber))
    .limit(1)
    .as("newest");
  const [row] = await ctx.db
    .select({
      code: entry.code,
      status: entry.status,
      title: entry.title,
      description: entry.description,
      statement: entry.statement,
      discipline: entry.discipline,
      competitionId: entry.competitionId,
      competitionName: competition.name,
      competitionSlug: competition.slug,
      registrationId: entry.registrationId,
      registrationStatus: registration.status,
      registrationRoute: registration.route,
      participantName: participantProfile.fullName,
      submittedAt: entry.submittedAt,
      liveAssetId: entryFile.fileAssetId,
      newestStatus: newest.status,
    })
    .from(entry)
    .innerJoin(competition, eq(competition.id, entry.competitionId))
    .innerJoin(registration, eq(registration.id, entry.registrationId))
    .innerJoin(
      participantProfile,
      eq(participantProfile.id, entry.participantProfileId)
    )
    .leftJoin(
      entryFile,
      and(eq(entryFile.entryId, entry.id), eq(entryFile.status, "live"))
    )
    .leftJoinLateral(newest, sql`true`)
    .where(
      and(eq(entry.code, code), eq(entry.participantProfileId, scope.profileId))
    );
  if (!row)
    throw new DomainError("forbidden", "Entry is outside the viewer's scope");

  const picture = row.liveAssetId
    ? await moduleDerivativeUrl(ctx, row.liveAssetId, "display_1600")
    : null;
  const window: SubmissionWindow | undefined = (
    await submissionWindows(ctx.db, [row.competitionId])
  ).get(row.competitionId);
  const canUpload =
    row.registrationRoute === "individual" &&
    row.registrationStatus === "confirmed" &&
    window !== undefined &&
    decideUpload({
      entry: { status: row.status, files: [] },
      window,
      now: ctx.clock.now(),
    }).ok &&
    (await participationRefusals(ctx.db, ctx, [row.registrationId])).size === 0;

  return {
    ok: true,
    entry: {
      code: row.code,
      status: row.status,
      title: row.title,
      description: row.description,
      statement: row.statement,
      discipline: row.discipline,
      competition: { name: row.competitionName, slug: row.competitionSlug },
      closesAt: window?.closesAt ?? null,
      registrationId: row.registrationId,
      participantName: row.participantName,
      whose: visible.whose,
      submittedAt: row.submittedAt,
      picture: picture
        ? { url: picture.url, width: picture.width, height: picture.height }
        : null,
      latestUpload: row.newestStatus
        ? (LATEST[row.newestStatus] ?? null)
        : null,
      uploadRule: canUpload ? uploadRuleFor(row.discipline) : null,
    },
  };
}
