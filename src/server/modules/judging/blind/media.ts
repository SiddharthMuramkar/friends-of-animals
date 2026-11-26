import { and, eq, inArray } from "drizzle-orm";
import { entryFile, fileAsset, fileDerivative } from "../../../db/schema";
import { essayBodyText, sanitizeEssayBody } from "../../../rich-text/essay";
import type { UseCaseContext } from "../../../use-cases";
import { DOWNLOAD_URL_TTL_SECONDS } from "../../files/use-cases/delivery";
import type { BlindMedia } from "./domain/blind-entry-view";
import {
  blindMediaFilename,
  planJudgingMedia,
  type JudgingDerivative,
} from "./domain/judging-media";

const fields = {
  kind: fileDerivative.kind,
  bucket: fileDerivative.bucket,
  storageKey: fileDerivative.storageKey,
  contentType: fileDerivative.contentType,
  width: fileDerivative.width,
  height: fileDerivative.height,
  durationMs: fileDerivative.durationMs,
};
// Only canonical derivative keys and expected media types are eligible. The
// original key/filename is neither selected nor used to build a URL.
function isDerived(row: JudgingDerivative, fileId: string) {
  const types: Record<string, string> = {
    display_1600: "image/webp",
    thumb_320: "image/webp",
    video_mp4: "video/mp4",
    video_poster: "image/jpeg",
    pdf_clean: "application/pdf",
  };
  const extensions: Record<string, string> = {
    display_1600: "webp",
    thumb_320: "webp",
    video_mp4: "mp4",
    video_poster: "jpg",
    pdf_clean: "pdf",
  };
  const path = `derived/${fileId}/${row.kind}.${extensions[row.kind]}`;
  return (
    Object.hasOwn(types, row.kind) &&
    row.contentType === types[row.kind] &&
    (row.storageKey === path ||
      (/^[a-z0-9-]+\//.test(row.storageKey) &&
        row.storageKey.slice(row.storageKey.indexOf("/") + 1) === path))
  );
}
async function sign(ctx: UseCaseContext, d: JudgingDerivative) {
  const { url } = await ctx.storage.presignGet({
    bucket: d.bucket,
    key: d.storageKey,
    expiresInSeconds: DOWNLOAD_URL_TTL_SECONDS,
    contentType: d.contentType,
    disposition: "inline",
    filename: blindMediaFilename(d.contentType, 1),
  });
  return url;
}

export async function blindWorkMedia(
  ctx: UseCaseContext,
  entryId: string
): Promise<BlindMedia[]> {
  const [live] = await ctx.db
    .select({
      kind: entryFile.kind,
      fileId: entryFile.fileAssetId,
      essayBody: entryFile.essayBody,
    })
    .from(entryFile)
    .where(and(eq(entryFile.entryId, entryId), eq(entryFile.status, "live")));
  if (!live) return [{ kind: "unavailable" }];
  if (live.kind === "text") {
    return [
      {
        kind: "essay_text",
        text: essayBodyText(sanitizeEssayBody(live.essayBody)),
      },
    ];
  }
  if (!live.fileId) return [{ kind: "unavailable" }];
  const derivatives = await ctx.db
    .select(fields)
    .from(fileDerivative)
    .innerJoin(fileAsset, eq(fileAsset.id, fileDerivative.fileAssetId))
    .where(and(eq(fileAsset.id, live.fileId), eq(fileAsset.status, "clean")));
  const plan = planJudgingMedia({
    kind: live.kind,
    derivatives: derivatives.filter((d) => isDerived(d, live.fileId!)),
  });
  switch (plan.kind) {
    case "image":
      return [
        {
          kind: "image",
          url: await sign(ctx, plan.display),
          width: plan.display.width,
          height: plan.display.height,
          thumbnailUrl: plan.thumbnail ? await sign(ctx, plan.thumbnail) : null,
        },
      ];
    case "video":
      return [
        {
          kind: "video",
          url: await sign(ctx, plan.video),
          posterUrl: plan.poster ? await sign(ctx, plan.poster) : null,
          width: plan.video.width,
          height: plan.video.height,
          durationMs: plan.video.durationMs,
        },
      ];
    case "document":
      return [{ kind: "document", url: await sign(ctx, plan.document) }];
    default:
      return [{ kind: "unavailable" }];
  }
}

export async function blindThumbnails(ctx: UseCaseContext, entryIds: string[]) {
  if (!entryIds.length) return new Map<string, string>();
  const rows = await ctx.db
    .select({
      ...fields,
      entryId: entryFile.entryId,
      fileId: fileDerivative.fileAssetId,
      fileKind: entryFile.kind,
    })
    .from(entryFile)
    .innerJoin(fileAsset, eq(fileAsset.id, entryFile.fileAssetId))
    .innerJoin(fileDerivative, eq(fileDerivative.fileAssetId, fileAsset.id))
    .where(
      and(
        inArray(entryFile.entryId, entryIds),
        eq(entryFile.status, "live"),
        eq(fileAsset.status, "clean"),
        inArray(fileDerivative.kind, ["thumb_320", "video_poster"])
      )
    );
  return new Map(
    await Promise.all(
      rows
        .filter(
          (row) =>
            isDerived(row, row.fileId) &&
            ((row.fileKind === "image" && row.kind === "thumb_320") ||
              (row.fileKind === "video" && row.kind === "video_poster"))
        )
        .map(async (row) => [row.entryId, await sign(ctx, row)] as const)
    )
  );
}
