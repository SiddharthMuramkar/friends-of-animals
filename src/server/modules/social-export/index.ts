import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import { authorize } from "../../access/can";
import { recordAudit } from "../../audit/record";
import { galleryItem, socialExport } from "../../db/schema";
import { uuidv7 } from "../../ids";
import type { UseCaseContext } from "../../use-cases";
import { queueStamp, stampedImage, stampedImageUrl } from "../stamping";
import { liveSocialSource, lockedGallery, matchesSource } from "./evidence";

const failure = <T extends string>(error: T) => ({ ok: false, error }) as const;
const captionPurpose = "social_export.caption";

async function listSocialExportCandidates(ctx: UseCaseContext) {
  await authorize(ctx, "social_export.manage");
  const rows = await ctx.db
    .select({ gallery: galleryItem, row: socialExport })
    .from(galleryItem)
    .leftJoin(socialExport, eq(socialExport.galleryItemId, galleryItem.id))
    .where(eq(galleryItem.status, "published"))
    .orderBy(desc(galleryItem.id));
  const result = [];
  for (const { gallery, row } of rows) {
    const source = await liveSocialSource(ctx, gallery);
    if (source.ok && !(row && matchesSource(row, source)))
      result.push({
        itemId: gallery.id,
        title: gallery.title,
        credit: source.credit,
      });
  }
  return result;
}

async function queueSocialExport(
  ctx: UseCaseContext,
  input: { itemId: string }
) {
  const { role } = await authorize(ctx, "social_export.manage");
  return ctx.db.transaction(async (tx) => {
    const scoped = { ...ctx, db: tx };
    const gallery = await lockedGallery(scoped, input.itemId);
    if (!gallery) return failure("not_found");
    const source = await liveSocialSource(scoped, gallery);
    if (!source.ok) return source;
    const [prior] = await tx
      .select()
      .from(socialExport)
      .where(eq(socialExport.galleryItemId, gallery.id))
      .for("update");
    const stamp = await queueStamp(tx, ctx.clock, {
      fileId: source.fileId,
      variant: "social",
    });
    if (prior && matchesSource(prior, source)) return failure("already_queued");
    if (stamp === "unavailable") return failure("no_safe_image");
    const now = ctx.clock.now();
    // Caption is reviewed gallery text only; credit is derived separately on
    // every read, never embedded in the durable caption.
    const caption = [gallery.title, gallery.story].filter(Boolean).join("\n\n");
    if (prior) {
      await tx.delete(socialExport).where(eq(socialExport.id, prior.id));
      await recordAudit(tx, ctx, {
        action: "social_export.retired",
        entity: { type: "social_export", id: prior.id },
        before: { status: prior.status },
        after: null,
        actorRole: role,
      });
    }
    const exportId = uuidv7(now);
    await tx
      .insert(socialExport)
      .values({
        id: exportId,
        galleryItemId: gallery.id,
        galleryConsentEventId: source.galleryConsentEventId,
        socialConsentEventId: source.socialConsentEventId,
        fileId: source.fileId,
        captionCiphertext: ctx.cipher.encrypt(captionPurpose, caption),
        status: "pending",
        createdAt: now,
        updatedAt: now,
      });
    await recordAudit(tx, ctx, {
      action: "social_export.queued",
      entity: { type: "social_export", id: exportId },
      before: null,
      after: { status: "pending", itemId: gallery.id },
      actorRole: role,
    });
    return { ok: true, exportId, stamp } as const;
  });
}

async function listSocialExports(ctx: UseCaseContext) {
  await authorize(ctx, "social_export.manage");
  const rows = await ctx.db
    .select({ row: socialExport, gallery: galleryItem })
    .from(socialExport)
    .innerJoin(galleryItem, eq(socialExport.galleryItemId, galleryItem.id))
    .orderBy(desc(socialExport.id));
  const result = [];
  for (const { row, gallery } of rows) {
    const source = await liveSocialSource(ctx, gallery);
    if (!source.ok || !matchesSource(row, source)) continue;
    result.push({
      exportId: row.id,
      itemId: gallery.id,
      title: gallery.title,
      caption: ctx.cipher.decrypt(captionPurpose, row.captionCiphertext),
      credit: source.credit,
      status: row.status,
      stampReady: !!(await stampedImage(ctx, {
        fileId: source.fileId,
        variant: "social",
      })),
    });
  }
  return result;
}

/** Lock and re-check every export action against its exact currently-live grants
 * and source. The gallery lock precedes the export lock, matching queueing. */
async function lockedExport(ctx: UseCaseContext, exportId: string) {
  if (!z.uuid().safeParse(exportId).success) return failure("not_found");
  const [prior] = await ctx.db
    .select()
    .from(socialExport)
    .where(eq(socialExport.id, exportId));
  if (!prior) return failure("not_found");
  const gallery = await lockedGallery(ctx, prior.galleryItemId);
  if (!gallery) return failure("not_found");
  const [row] = await ctx.db
    .select()
    .from(socialExport)
    .where(eq(socialExport.id, exportId))
    .for("update");
  if (!row) return failure("not_found");
  const source = await liveSocialSource(ctx, gallery);
  if (!source.ok) return source;
  if (!matchesSource(row, source)) return failure("source_changed");
  return { ok: true, row, source } as const;
}

async function editSocialCaption(
  ctx: UseCaseContext,
  input: { exportId: string; caption: string }
) {
  const { role } = await authorize(ctx, "social_export.manage");
  const parsed = z.string().max(2200).safeParse(input.caption);
  if (!parsed.success) return failure("invalid_input");
  const caption = parsed.data
    .normalize("NFC")
    .replace(/[\p{Cc}\p{Cf}]/gu, (char) => (char === "\n" ? char : ""))
    .trim();
  if (!caption) return failure("invalid_input");
  return ctx.db.transaction(async (tx) => {
    const live = await lockedExport({ ...ctx, db: tx }, input.exportId);
    if (!live.ok) return live;
    if (live.row.status === "posted") return failure("already_posted");
    await tx
      .update(socialExport)
      .set({
        captionCiphertext: ctx.cipher.encrypt(captionPurpose, caption),
        updatedAt: ctx.clock.now(),
      })
      .where(eq(socialExport.id, live.row.id));
    await recordAudit(tx, ctx, {
      action: "social_export.caption_edited",
      entity: { type: "social_export", id: live.row.id },
      before: null,
      after: { captionEdited: true },
      actorRole: role,
    });
    return { ok: true } as const;
  });
}

async function getSocialExportDownload(
  ctx: UseCaseContext,
  input: { exportId: string }
) {
  await authorize(ctx, "social_export.manage");
  return ctx.db.transaction(async (tx) => {
    const scoped = { ...ctx, db: tx };
    const live = await lockedExport(scoped, input.exportId);
    if (!live.ok) return live;
    const filename = `foa-social-${live.row.id}.png`;
    const image = await stampedImageUrl(scoped, {
      fileId: live.source.fileId,
      variant: "social",
      filename,
    });
    if (!image) return failure("stamp_pending");
    return {
      ok: true,
      ...image,
      filename,
      caption: ctx.cipher.decrypt(captionPurpose, live.row.captionCiphertext),
      credit: live.source.credit,
    } as const;
  });
}

async function markSocialExportPosted(
  ctx: UseCaseContext,
  input: { exportId: string }
) {
  const { role } = await authorize(ctx, "social_export.manage");
  return ctx.db.transaction(async (tx) => {
    const scoped = { ...ctx, db: tx };
    const live = await lockedExport(scoped, input.exportId);
    if (!live.ok) return live;
    if (live.row.status === "posted") return failure("already_posted");
    if (
      !(await stampedImage(scoped, {
        fileId: live.source.fileId,
        variant: "social",
      }))
    )
      return failure("stamp_pending");
    const now = ctx.clock.now();
    await tx
      .update(socialExport)
      .set({ status: "posted", postedAt: now, updatedAt: now })
      .where(eq(socialExport.id, live.row.id));
    await recordAudit(tx, ctx, {
      action: "social_export.posted",
      entity: { type: "social_export", id: live.row.id },
      before: { status: "pending" },
      after: { status: "posted" },
      actorRole: role,
    });
    return { ok: true } as const;
  });
}

export const socialExportUseCases = (ctx: UseCaseContext) => ({
  listSocialExportCandidates: () => listSocialExportCandidates(ctx),
  queueSocialExport: (input: { itemId: string }) =>
    queueSocialExport(ctx, input),
  listSocialExports: () => listSocialExports(ctx),
  editSocialCaption: (input: { exportId: string; caption: string }) =>
    editSocialCaption(ctx, input),
  getSocialExportDownload: (input: { exportId: string }) =>
    getSocialExportDownload(ctx, input),
  markSocialExportPosted: (input: { exportId: string }) =>
    markSocialExportPosted(ctx, input),
});
