import { and, desc, eq, lt } from "drizzle-orm";
import { z } from "zod";
import { authorize } from "../../access/can";
import { galleryItem, type GalleryItemRow } from "../../db/schema";
import type { UseCaseContext } from "../../use-cases";
import { ObjectMissingError } from "../../ports/storage";
import { liveGallerySource } from "./evidence";

export const galleryPath = (itemId: string) => `/gallery/${itemId}`;
export const galleryMediaPath = (itemId: string) => `/media/gallery/${itemId}`;
export const galleryThumbnailPath = (itemId: string) =>
  `${galleryMediaPath(itemId)}?size=thumb`;
export async function galleryRow(
  ctx: Pick<UseCaseContext, "db">,
  itemId: string
) {
  if (!z.uuid().safeParse(itemId).success) return null;
  const [row] = await ctx.db
    .select()
    .from(galleryItem)
    .where(eq(galleryItem.id, itemId));
  return row ?? null;
}
async function toPublic(ctx: UseCaseContext, row: GalleryItemRow) {
  const source = await liveGallerySource(ctx, row);
  if (!source?.image) return null;
  return {
    itemId: row.id,
    title: row.title,
    story: row.story,
    competition: {
      name: source.facts.competition.name,
      slug: source.facts.competition.slug,
    },
    category: source.facts.category,
    discipline: source.facts.entry.discipline,
    recognition: source.award,
    credit: source.credit,
    image: {
      url: galleryMediaPath(row.id),
      thumbnailUrl: galleryThumbnailPath(row.id),
      width: source.image.width,
      height: source.image.height,
      sampleIllustration: source.image.sampleIllustration,
    },
  };
}
export type PublicGalleryItem = NonNullable<
  Awaited<ReturnType<typeof toPublic>>
>;
export type GalleryFilters = {
  competition?: string;
  discipline?: string;
  category?: string;
  recognition?: string;
  cursor?: string;
};
export async function listPublicGallery(
  ctx: UseCaseContext,
  input: GalleryFilters = {},
  options: { featured?: boolean; limit?: number } = {}
) {
  await authorize(ctx, "gallery.read_published");
  const limit = options.limit ?? 24;
  const items: PublicGalleryItem[] = [];
  const competitions = new Map<string, PublicGalleryItem["competition"]>();
  const disciplines = new Set<string>();
  const categories = new Set<string>();
  const recognitions = new Set<string>();
  const after = z.uuid().safeParse(input.cursor).success
    ? input.cursor?.toLowerCase()
    : undefined;
  let cursor: string | undefined;
  // Facets are global, not derived from the current page or its filters.
  // Use the exact live projection gate for both, retaining only distinct
  // public values and one page of items. Featured artwork needs no facets.
  const collectFacets = !options.featured;
  while (collectFacets || items.length <= limit) {
    const rows = await ctx.db
      .select()
      .from(galleryItem)
      .where(
        and(
          eq(galleryItem.status, "published"),
          options.featured ? eq(galleryItem.featured, true) : undefined,
          cursor ? lt(galleryItem.id, cursor) : undefined
        )
      )
      .orderBy(desc(galleryItem.id))
      .limit(12);
    for (
      let i = 0;
      i < rows.length && (collectFacets || items.length <= limit);
      i += 6
    ) {
      const projected = await Promise.all(
        rows.slice(i, i + 6).map((r) => toPublic(ctx, r))
      );
      for (const item of projected) {
        if (!item) continue;
        const recognition = item.recognition?.value ?? "none";
        if (collectFacets) {
          competitions.set(item.competition.slug, item.competition);
          disciplines.add(item.discipline);
          categories.add(item.category);
          recognitions.add(recognition);
        }
        if (
          items.length <= limit &&
          (!after || item.itemId < after) &&
          (!input.competition || item.competition.slug === input.competition) &&
          (!input.discipline || item.discipline === input.discipline) &&
          (!input.category || item.category === input.category) &&
          (!input.recognition || recognition === input.recognition)
        )
          items.push(item);
      }
    }
    if (rows.length < 12) break;
    cursor = rows.at(-1)?.id;
  }
  return {
    items: items.slice(0, limit),
    nextCursor: items.length > limit ? items[limit - 1]!.itemId : null,
    facets: {
      competition: [...competitions.values()].sort(
        (a, b) => a.name.localeCompare(b.name) || a.slug.localeCompare(b.slug)
      ),
      discipline: [...disciplines].sort(),
      category: [...categories].sort(),
      recognition: [...recognitions].sort(),
    },
  };
}
export async function featuredGalleryItems(ctx: UseCaseContext) {
  return (await listPublicGallery(ctx, {}, { featured: true, limit: 3 })).items;
}
export async function getPublicGalleryItem(
  ctx: UseCaseContext,
  input: { itemId: string }
) {
  await authorize(ctx, "gallery.read_published");
  const row = await galleryRow(ctx, input.itemId);
  return row ? toPublic(ctx, row) : null;
}
export async function readGalleryImage(
  ctx: UseCaseContext,
  input: { itemId: string; size?: "thumb" }
) {
  await authorize(ctx, "gallery.read_published");
  const missing = { ok: false, error: "not_found" } as const;
  const row = await galleryRow(ctx, input.itemId);
  const source = row && (await liveGallerySource(ctx, row));
  const image =
    input.size === undefined
      ? source?.image
      : input.size === "thumb"
        ? source?.thumbnail
        : null;
  if (!image) return missing;
  try {
    const body = await ctx.storage.read({
      bucket: image.bucket,
      key: image.key,
    });
    return {
      ok: true,
      body,
      contentType: image.contentType,
      sizeBytes: image.sizeBytes,
    } as const;
  } catch (error) {
    if (error instanceof ObjectMissingError) return missing;
    throw error;
  }
}

/** Staff review sees the same safe stamp, even for a draft; never an original. */
export async function readGalleryDraftImage(
  ctx: UseCaseContext,
  input: { itemId: string }
) {
  await authorize(ctx, "gallery.curate");
  const row = await galleryRow(ctx, input.itemId);
  const missing = { ok: false, error: "not_found" } as const;
  if (!row) return missing;
  const { eligibleEntry } = await import("./evidence");
  const source = await eligibleEntry(ctx, row.entryId);
  if (
    !source.eligible ||
    !source.image ||
    source.consentEventId !== row.consentEventId ||
    source.fileId !== row.fileId
  )
    return missing;
  try {
    return {
      ok: true,
      body: await ctx.storage.read({
        bucket: source.image.bucket,
        key: source.image.key,
      }),
      contentType: source.image.contentType,
      sizeBytes: source.image.sizeBytes,
    } as const;
  } catch (error) {
    if (error instanceof ObjectMissingError) return missing;
    throw error;
  }
}
