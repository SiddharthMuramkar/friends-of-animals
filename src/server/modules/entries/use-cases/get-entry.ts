// getEntry({ code }) (#85, #86): one entry's page, for the participant it
// belongs to, a teen with their own login, or the child's guardian. It
// shows the entry's live work until a replacement has passed its checks,
// each through a short-lived signed URL: a picture's large derivative, a
// video's transcoded copy and poster (never its original), an essay's
// typed text (the `essay` profile's paragraphs) or its PDF. It also says
// where the latest upload stands (and why it failed, when worker-media
// said), and whether a new submission can go ahead now.
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
  fileProcessing,
  participantProfile,
  registration,
} from "../../../db/schema";
import { DomainError } from "../../../errors";
import { invalidInput, type InvalidInput } from "../../../input";
import type { UseCaseContext } from "../../../use-cases";
import type { Discipline } from "../../competitions/domain/vocabulary";
import { participationRefusals } from "../../consent/participation-gate";
import type { FileProcessingErrorCode } from "../../../ports/media";
import { sanitizeEssayBody, type EssayBody } from "../../../rich-text/essay";
import { moduleFileUrl } from "../../files/use-cases/delivery";
import { moduleDerivativeUrl } from "../../files/use-cases/derivative-url";
import { visibleProfiles } from "../../participants/list-my-registrations";
import { parseEntryCode } from "../domain/entry-code";
import type { EntryFileStatus, EntryStatus } from "../domain/status";
import { decideUpload, type SubmissionWindow } from "../domain/submission";
import type { UploadRule } from "../domain/upload-rules";
import { submissionWindows } from "../registration-facts";
import { formatOf, uploadRuleFor, type EntryFormat } from "../rules";

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
  /** How the discipline's work is submitted: picture, video or essay. */
  format: EntryFormat;
  /** The live picture's large copy; null until one is live. */
  picture: { url: string; width: number; height: number } | null;
  /**
   * The live video's watchable copy and its poster (#86); null until one
   * is live. The original is never served.
   */
  video: {
    url: string;
    posterUrl: string | null;
    width: number;
    height: number;
    durationMs: number | null;
  } | null;
  /** The live essay (#86): typed text, or a PDF; null until one is live. */
  essay:
    | { kind: "text"; body: EssayBody; wordCount: number }
    | { kind: "document"; url: string }
    | null;
  /** Where the newest upload stands, unless it is the live one. */
  latestUpload: Extract<
    EntryFileStatus,
    "pending" | "processing" | "rejected" | "failed"
  > | null;
  /** Why the newest upload failed, when its media job said (#86). */
  latestProblem: FileProcessingErrorCode | null;
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
    .select({
      status: entryFile.status,
      problem: fileProcessing.errorCode,
    })
    .from(entryFile)
    .leftJoin(
      fileProcessing,
      eq(fileProcessing.fileAssetId, entryFile.fileAssetId)
    )
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
      liveKind: entryFile.kind,
      liveEssay: entryFile.essayBody,
      liveWordCount: entryFile.wordCount,
      newestStatus: newest.status,
      newestProblem: newest.problem,
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

  const asset = row.liveAssetId;
  const picture =
    asset && row.liveKind === "image"
      ? await moduleDerivativeUrl(ctx, asset, "display_1600")
      : null;
  const copy =
    asset && row.liveKind === "video"
      ? await moduleDerivativeUrl(ctx, asset, "video_mp4")
      : null;
  const poster =
    copy && asset
      ? await moduleDerivativeUrl(ctx, asset, "video_poster")
      : null;
  const document =
    asset && row.liveKind === "document"
      ? await moduleFileUrl(ctx, asset)
      : null;
  const essay: EntryDetail["essay"] =
    row.liveKind === "text" && row.liveEssay && row.liveWordCount
      ? {
          kind: "text",
          body: sanitizeEssayBody(row.liveEssay),
          wordCount: row.liveWordCount,
        }
      : document
        ? { kind: "document", url: document.url }
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
      format: formatOf(row.discipline) ?? "image",
      picture: picture
        ? { url: picture.url, width: picture.width, height: picture.height }
        : null,
      video: copy
        ? {
            url: copy.url,
            posterUrl: poster?.url ?? null,
            width: copy.width,
            height: copy.height,
            durationMs: copy.durationMs,
          }
        : null,
      essay,
      latestUpload: row.newestStatus
        ? (LATEST[row.newestStatus] ?? null)
        : null,
      latestProblem:
        row.newestStatus === "failed"
          ? ((row.newestProblem as FileProcessingErrorCode | null) ?? null)
          : null,
      uploadRule: canUpload ? uploadRuleFor(row.discipline) : null,
    },
  };
}
