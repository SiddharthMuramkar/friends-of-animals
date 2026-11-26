import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { authorize } from "../../access/can";
import { recordAudit } from "../../audit/record";
import {
  entry,
  galleryItem,
  galleryReport,
  type GalleryItemRow,
} from "../../db/schema";
import type { AppDb } from "../../db/app-db";
import type { UseCaseContext } from "../../use-cases";
import type { Role } from "../../access/domain/roles";
import { uuidv7 } from "../../ids";
import { queueStamp } from "../stamping";
import { eligibleEntry } from "./evidence";
import { retireHiddenGalleryExport } from "../social-export/withdrawal";
import { requestGalleryPurge } from "./purge";

const missing = { ok: false, error: "not_found" } as const;
const failure = <T extends string>(error: T) => ({ ok: false, error }) as const;
const segmenter = new Intl.Segmenter("en-IN", { granularity: "grapheme" });
const clean = (value: string) =>
  value
    .normalize("NFC")
    .replace(/[\p{Cc}\p{Cf}]/gu, (char) => (char === "\n" ? char : ""))
    .trim();
function reviewText(input: unknown) {
  const parsed = z
    .object({
      title: z.string().max(2000),
      story: z.string().max(8000),
      featured: z.boolean(),
    })
    .safeParse(input);
  if (!parsed.success) return failure("invalid_input");
  const title = clean(parsed.data.title).replace(/\s+/gu, " ");
  const story = clean(parsed.data.story)
    .split("\n")
    .map((line) => line.trim().replace(/\s+/gu, " "))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
  if (!title || [...segmenter.segment(title)].length > 120)
    return failure("title_too_long");
  if ([...segmenter.segment(story)].length > 500)
    return failure("story_too_long");
  return { ok: true, title, story, featured: parsed.data.featured } as const;
}
async function queueGalleryStamps(
  tx: AppDb,
  clock: UseCaseContext["clock"],
  fileId: string
) {
  const full = await queueStamp(tx, clock, { fileId, variant: "gallery" });
  if (full === "unavailable") return full;
  const small = await queueStamp(tx, clock, {
    fileId,
    variant: "gallery_thumb",
  });
  if (small === "unavailable") return small;
  return full === "ready" && small === "ready" ? "ready" : "queued";
}
async function lockedItem(tx: AppDb, itemId: string) {
  if (!z.uuid().safeParse(itemId).success) return null;
  const [row] = await tx
    .select()
    .from(galleryItem)
    .where(eq(galleryItem.id, itemId))
    .for("update");
  return row ?? null;
}
export async function listGalleryCandidates(
  ctx: UseCaseContext,
  input: { competitionId?: string } = {}
) {
  await authorize(ctx, "gallery.curate");
  if (input.competitionId && !z.uuid().safeParse(input.competitionId).success)
    return [];
  const rows = await ctx.db
    .select({
      entryId: entry.id,
      entryCode: entry.code,
      title: entry.title,
      competitionId: entry.competitionId,
    })
    .from(entry)
    .where(
      and(
        inArray(entry.status, ["foa_verified", "not_shortlisted"]),
        input.competitionId
          ? eq(entry.competitionId, input.competitionId)
          : undefined
      )
    )
    .orderBy(desc(entry.id));
  const result = [];
  for (const row of rows) {
    const source = await eligibleEntry(ctx, row.entryId);
    result.push({
      ...row,
      eligible: source.eligible,
      reason: source.eligible ? null : source.reason,
      credit: source.eligible ? source.credit : null,
    });
  }
  return result;
}
export async function pickGalleryEntry(
  ctx: UseCaseContext,
  input: { entryId: string }
) {
  const { role } = await authorize(ctx, "gallery.curate");
  if (!z.uuid().safeParse(input.entryId).success) return missing;
  return ctx.db.transaction(async (tx) => {
    const source = await eligibleEntry({ ...ctx, db: tx }, input.entryId, true);
    if (!source.eligible) return failure(source.reason);
    const [prior] = await tx
      .select()
      .from(galleryItem)
      .where(eq(galleryItem.entryId, input.entryId))
      .for("update");
    if (prior && prior.status !== "unpublished")
      return failure("already_picked");
    const stamp = await queueGalleryStamps(tx, ctx.clock, source.fileId);
    if (stamp === "unavailable") return failure("no_safe_image");
    const now = ctx.clock.now();
    const itemId = prior?.id ?? uuidv7(now);
    const values = {
      entryId: input.entryId,
      consentEventId: source.consentEventId,
      fileId: source.fileId,
      status: "draft" as const,
      title: source.facts.entry.title,
      story: "",
      reviewed: false,
      featured: false,
      reason: null,
      publishedAt: null,
      updatedAt: now,
    };
    await tx
      .insert(galleryItem)
      .values({ id: itemId, ...values, createdAt: now })
      .onConflictDoUpdate({ target: galleryItem.id, set: values });
    await recordAudit(tx, ctx, {
      action: "gallery.picked",
      entity: { type: "gallery_item", id: itemId },
      before: prior ? { status: prior.status } : null,
      after: { status: "draft", entryId: input.entryId },
      actorRole: role,
    });
    return { ok: true, itemId, stamp } as const;
  });
}
export async function editGalleryItem(
  ctx: UseCaseContext,
  input: { itemId: string; title: string; story: string; featured: boolean }
) {
  const { role } = await authorize(ctx, "gallery.curate");
  const review = reviewText(input);
  if (!review.ok) return review;
  return ctx.db.transaction(async (tx) => {
    const row = await lockedItem(tx, input.itemId);
    if (!row) return missing;
    if (row.status !== "draft") return failure("invalid_transition");
    await tx
      .update(galleryItem)
      .set({
        title: review.title,
        story: review.story,
        featured: review.featured,
        reviewed: true,
        updatedAt: ctx.clock.now(),
      })
      .where(eq(galleryItem.id, row.id));
    await recordAudit(tx, ctx, {
      action: "gallery.edited",
      entity: { type: "gallery_item", id: row.id },
      before: { reviewed: row.reviewed },
      after: { reviewed: true, featured: review.featured },
      actorRole: role,
    });
    return { ok: true } as const;
  });
}
/** All moves out of publication share the durable purge and audit writer. */
export async function retireGalleryItem(
  ctx: Pick<UseCaseContext, "db" | "clock" | "actor">,
  row: GalleryItemRow,
  status: "unpublished" | "hidden",
  reason: string,
  role: Role | null,
  requestedAt = ctx.clock.now()
) {
  if (row.status === "unpublished" || row.status === status) return;
  const now = ctx.clock.now();
  await ctx.db
    .update(galleryItem)
    .set({ status, reason, updatedAt: now })
    .where(eq(galleryItem.id, row.id));
  if (status === "hidden") await retireHiddenGalleryExport(ctx, row.id, role);
  if (row.status === "published")
    await requestGalleryPurge(ctx, row.id, requestedAt);
  await recordAudit(ctx.db, ctx, {
    action: `gallery.${status}`,
    entity: { type: "gallery_item", id: row.id },
    before: { status: row.status },
    after: { status, reason },
    actorRole: role,
  });
}
export async function publishGalleryItem(
  ctx: UseCaseContext,
  input: { itemId: string }
) {
  const { role } = await authorize(ctx, "gallery.curate");
  return ctx.db.transaction(async (tx) => {
    // Subject lock precedes gallery lock, matching pick/withdrawal ordering.
    const [prior] = z.uuid().safeParse(input.itemId).success
      ? await tx
          .select()
          .from(galleryItem)
          .where(eq(galleryItem.id, input.itemId))
      : [];
    if (!prior) return missing;
    const source = await eligibleEntry({ ...ctx, db: tx }, prior.entryId, true);
    const row = await lockedItem(tx, input.itemId);
    if (!row) return missing;
    if (row.status !== "draft") return failure("invalid_transition");
    if (!source.eligible) return failure(source.reason);
    if (
      source.consentEventId !== row.consentEventId ||
      source.fileId !== row.fileId
    )
      return failure("source_changed");
    if (!row.reviewed) return failure("review_required");
    if (!source.image || !source.thumbnail) {
      await queueGalleryStamps(tx, ctx.clock, row.fileId);
      return failure("stamp_pending");
    }
    const now = ctx.clock.now();
    await tx
      .update(galleryItem)
      .set({ status: "published", publishedAt: now, updatedAt: now })
      .where(eq(galleryItem.id, row.id));
    await recordAudit(tx, ctx, {
      action: "gallery.published",
      entity: { type: "gallery_item", id: row.id },
      before: { status: row.status },
      after: { status: "published" },
      actorRole: role,
    });
    return { ok: true } as const;
  });
}
export async function listGalleryItemsForAdmin(ctx: UseCaseContext) {
  await authorize(ctx, "gallery.curate");
  const rows = await ctx.db
    .select({ row: galleryItem, entryCode: entry.code })
    .from(galleryItem)
    .innerJoin(entry, eq(entry.id, galleryItem.entryId))
    .orderBy(desc(galleryItem.createdAt));
  return Promise.all(
    rows.map(async ({ row, entryCode }) => {
      const source = await eligibleEntry(ctx, row.entryId);
      return {
        itemId: row.id,
        entryCode,
        status: row.status,
        title: row.title,
        story: row.story,
        featured: row.featured,
        reviewed: row.reviewed,
        reason: row.reason,
        credit: source.eligible ? source.credit : null,
        stampReady:
          source.eligible &&
          !!source.image &&
          !!source.thumbnail &&
          source.fileId === row.fileId,
        eligible:
          source.eligible &&
          source.consentEventId === row.consentEventId &&
          source.fileId === row.fileId,
      };
    })
  );
}
export async function hideGalleryItem(
  ctx: UseCaseContext,
  input: { itemId: string; reason: "reported" | "moderator" }
) {
  const { role } = await authorize(ctx, "gallery.curate");
  if (!["reported", "moderator"].includes(input.reason))
    return failure("invalid_input");
  return ctx.db.transaction(async (tx) => {
    const row = await lockedItem(tx, input.itemId);
    if (!row) return missing;
    if (row.status !== "published") return failure("invalid_transition");
    await retireGalleryItem(
      { ...ctx, db: tx },
      row,
      "hidden",
      input.reason,
      role
    );
    await tx
      .update(galleryReport)
      .set({
        status: "actioned",
        handledAt: ctx.clock.now(),
        handledByUserId: ctx.actor.kind === "user" ? ctx.actor.userId : null,
      })
      .where(
        and(eq(galleryReport.itemId, row.id), eq(galleryReport.status, "open"))
      );
    return { ok: true } as const;
  });
}
export async function restoreGalleryItem(
  ctx: UseCaseContext,
  input: { itemId: string }
) {
  const { role } = await authorize(ctx, "gallery.curate");
  return ctx.db.transaction(async (tx) => {
    const [prior] = z.uuid().safeParse(input.itemId).success
      ? await tx
          .select()
          .from(galleryItem)
          .where(eq(galleryItem.id, input.itemId))
      : [];
    if (!prior) return missing;
    const source = await eligibleEntry({ ...ctx, db: tx }, prior.entryId, true);
    const row = await lockedItem(tx, input.itemId);
    if (!row || row.status !== "hidden") return failure("invalid_transition");
    if (!source.eligible) return failure(source.reason);
    const stamp = await queueGalleryStamps(tx, ctx.clock, source.fileId);
    if (stamp === "unavailable") return failure("no_safe_image");
    await tx
      .update(galleryItem)
      .set({
        status: "draft",
        consentEventId: source.consentEventId,
        fileId: source.fileId,
        reviewed: false,
        reason: null,
        publishedAt: null,
        updatedAt: ctx.clock.now(),
      })
      .where(eq(galleryItem.id, row.id));
    await recordAudit(tx, ctx, {
      action: "gallery.restored",
      entity: { type: "gallery_item", id: row.id },
      before: { status: row.status },
      after: { status: "draft" },
      actorRole: role,
    });
    return { ok: true } as const;
  });
}
