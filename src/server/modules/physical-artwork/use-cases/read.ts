// Reading physical artwork (#93). Staff see one competition's board and
// any artwork's detail in the competitions their roles cover; a sender
// sees only the artworks they send, with what to send, where and by when.
//
//   listArtworks({ competitionId, status?, query? })  staff board
//   getArtwork({ artworkCode })                       staff detail
//   listMyArtworks()                                  a sender's own
//
// Loads under plain Node: relative imports only, no "server-only".

import { and, asc, eq, type SQL } from "drizzle-orm";
import { z } from "zod";

import { physicalArtwork } from "../../../db/schema";
import type { UseCaseContext } from "../../../use-cases";
import { normaliseArtworkCode } from "../domain/code";
import { PHYSICAL_ARTWORK_STATUSES } from "../domain/status";
import type { ArtworkPlatform } from "../platform";
import { actingUserId } from "./actor";
import { invalidInput, type InvalidInput } from "./input";
import { artworkView, sentBy, type ArtworkView } from "./view";

const listInput = z.object({
  competitionId: z.uuid(),
  status: z.enum(PHYSICAL_ARTWORK_STATUSES).optional(),
  /** An Artwork ID or a tracking number, as staff type it. */
  query: z.string().trim().max(60).optional(),
});

export type ListArtworksInput = z.input<typeof listInput>;

export type ListArtworksResult =
  | { ok: true; artworks: ArtworkView[] }
  | InvalidInput;

/** Board order: by status in custody order, then the nearest deadline. */
const BOARD_ORDER = [
  asc(physicalArtwork.status),
  asc(physicalArtwork.dispatchDeadline),
  asc(physicalArtwork.artworkCode),
];

/** What `query` matches: the Artwork ID it names, or a tracking number. */
function matching(query: string): SQL {
  const code = normaliseArtworkCode(query);
  if (code) return eq(physicalArtwork.artworkCode, code);
  return eq(
    physicalArtwork.trackingNumber,
    query.replace(/\s+/g, "").toUpperCase()
  );
}

export async function listArtworks(
  ctx: UseCaseContext,
  platform: ArtworkPlatform,
  input: ListArtworksInput
): Promise<ListArtworksResult> {
  await platform.authorizeStaff(
    ctx,
    "artwork.read",
    typeof input.competitionId === "string" ? input.competitionId : null
  );
  const parsed = listInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const { competitionId, status, query } = parsed.data;
  const rows = await ctx.db
    .select()
    .from(physicalArtwork)
    .where(
      and(
        eq(physicalArtwork.competitionId, competitionId),
        status ? eq(physicalArtwork.status, status) : undefined,
        query ? matching(query) : undefined
      )
    )
    .orderBy(...BOARD_ORDER);
  const now = ctx.clock.now();
  return { ok: true, artworks: rows.map((row) => artworkView(row, now)) };
}

export type GetArtworkResult =
  | { ok: true; artwork: ArtworkView }
  | { ok: false; error: "not_found" };

export async function getArtwork(
  ctx: UseCaseContext,
  platform: ArtworkPlatform,
  input: { artworkCode: string }
): Promise<GetArtworkResult> {
  const code =
    typeof input.artworkCode === "string"
      ? normaliseArtworkCode(input.artworkCode)
      : null;
  const [row] = code
    ? await ctx.db
        .select()
        .from(physicalArtwork)
        .where(eq(physicalArtwork.artworkCode, code))
    : [];
  // Checked before saying whether it exists: without a staff role covering
  // its competition, an artwork is refused, found or not.
  await platform.authorizeStaff(ctx, "artwork.read", row?.competitionId ?? null);
  if (!row) return { ok: false, error: "not_found" };
  return { ok: true, artwork: artworkView(row, ctx.clock.now()) };
}

export async function listMyArtworks(
  ctx: UseCaseContext,
  platform: ArtworkPlatform
): Promise<{ ok: true; artworks: ArtworkView[] }> {
  actingUserId(ctx);
  const scope = sentBy(await platform.senderScope(ctx.db, ctx.actor));
  if (!scope) return { ok: true, artworks: [] };
  const rows = await ctx.db
    .select()
    .from(physicalArtwork)
    .where(scope)
    .orderBy(...BOARD_ORDER);
  const now = ctx.clock.now();
  return { ok: true, artworks: rows.map((row) => artworkView(row, now)) };
}
