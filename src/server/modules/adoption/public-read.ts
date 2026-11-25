// What the public reads of adoption (#129): adoptable animals, filtered
// and paged newest first, one animal's page, and the slugs that have a
// page (src/proxy.ts answers any other /adopt/<slug> with a real 404).
//
// Nothing of a directory listing that isn't verified is public, whatever
// its animals' status: suspending the organisation hides every animal at
// once and reinstating it brings them back, with no adoption row changed.
// Photos are public only as their resized copies (./photo-rows.ts).

import {
  and,
  desc,
  eq,
  gte,
  inArray,
  lt,
  lte,
  or,
  type SQL,
} from "drizzle-orm";
import { z } from "zod";

import { authorize } from "../../access/can";
import {
  adoptionListing,
  directoryListing,
  type AdoptionListingRow,
} from "../../db/schema";
import type { UseCaseContext } from "../../use-cases";
import {
  ageBand,
  ageParts,
  birthMonthRange,
  fromDateColumn,
  toDateColumn,
  type AgeBand,
  type EstimatedAge,
} from "./domain/age";
import type { IndianState } from "./domain/details";
import {
  ADOPTION_PAGE_SIZE,
  cityKey,
  decodeBrowseCursor,
  encodeBrowseCursor,
  filtersToSearchParams,
  parseAdoptionFilters,
  type AdoptionFilters,
} from "./domain/filters";
import { ADOPTION_SLUG_PATTERN } from "./domain/slug";
import type { AdoptionListingStatus } from "./domain/status";
import { photosOf, publicPhotosOf, type PublicPhoto } from "./photo-rows";

/** The organisation offering an animal, as its public page names it. */
export type AdoptionOrganisation = { name: string; slug: string };

export type AdoptableAnimalCard = {
  slug: string;
  name: string;
  species: AdoptionListingRow["species"];
  sex: AdoptionListingRow["sex"];
  size: AdoptionListingRow["size"];
  age: EstimatedAge;
  ageBand: AgeBand;
  sterilised: boolean | null;
  city: string;
  state: IndianState;
  /** Browse lists only published animals; a page also opens on hold or adopted. */
  status: Extract<AdoptionListingStatus, "published" | "on_hold" | "adopted">;
  cover: PublicPhoto | null;
  organisation: AdoptionOrganisation;
};

export type AdoptableAnimal = AdoptableAnimalCard & {
  breed: string | null;
  colour: string | null;
  about: string | null;
  healthNotes: string | null;
  vaccinationNotes: string | null;
  conditions: string;
  pinCode: string;
  publishedAt: Date;
  photos: PublicPhoto[];
};

const PUBLIC_STATUSES = ["published", "on_hold", "adopted"] as const;

type Joined = {
  listing: AdoptionListingRow;
  organisation: AdoptionOrganisation;
};

function cardOf(
  { listing, organisation }: Joined,
  photos: PublicPhoto[],
  now: Date
): AdoptableAnimalCard {
  const birthMonth = fromDateColumn(listing.birthMonth);
  return {
    slug: listing.slug,
    name: listing.name,
    species: listing.species,
    sex: listing.sex,
    size: listing.size,
    age: ageParts(birthMonth, now),
    ageBand: ageBand(birthMonth, now),
    sterilised: listing.sterilised,
    city: listing.city,
    state: listing.state as IndianState,
    status: listing.status as AdoptableAnimalCard["status"],
    cover: photos[0] ?? null,
    organisation,
  };
}

function selectJoined(ctx: UseCaseContext) {
  return ctx.db
    .select({
      listing: adoptionListing,
      organisation: {
        name: directoryListing.name,
        slug: directoryListing.slug,
      },
    })
    .from(adoptionListing)
    .innerJoin(
      directoryListing,
      eq(directoryListing.id, adoptionListing.directoryListingId)
    );
}

export type BrowseAdoptableAnimalsInput = {
  filters?: AdoptionFilters;
  /** The `nextCursor` of the page before; absent for the first page. */
  cursor?: string | null;
};

export type BrowseAdoptableAnimalsResult = {
  animals: AdoptableAnimalCard[];
  /** For the next page; null on the last one. */
  nextCursor: string | null;
};

/** The conditions `filters` put on a published animal, as of `now`. */
function filterConditions(filters: AdoptionFilters, now: Date): SQL[] {
  const conditions: SQL[] = [];
  if (filters.species) {
    conditions.push(eq(adoptionListing.species, filters.species));
  }
  if (filters.age) {
    const { earliest, latest } = birthMonthRange(filters.age, now);
    conditions.push(lte(adoptionListing.birthMonth, toDateColumn(latest)));
    if (earliest) {
      conditions.push(gte(adoptionListing.birthMonth, toDateColumn(earliest)));
    }
  }
  if (filters.sex) conditions.push(eq(adoptionListing.sex, filters.sex));
  if (filters.size) conditions.push(eq(adoptionListing.size, filters.size));
  if (filters.state) conditions.push(eq(adoptionListing.state, filters.state));
  if (filters.city) {
    conditions.push(eq(adoptionListing.cityKey, cityKey(filters.city)));
  }
  if (filters.pin) conditions.push(eq(adoptionListing.pinCode, filters.pin));
  if (filters.sterilised) conditions.push(eq(adoptionListing.sterilised, true));
  return conditions;
}

/** Published animals of verified organisations, newest first. */
export async function browseAdoptableAnimals(
  ctx: UseCaseContext,
  input: BrowseAdoptableAnimalsInput = {}
): Promise<BrowseAdoptableAnimalsResult> {
  await authorize(ctx, "adoption.listing.read_public");
  // Whatever the caller passes goes through the same parser as a URL.
  const filters = parseAdoptionFilters(
    Object.fromEntries(
      new URLSearchParams(filtersToSearchParams(input.filters ?? {}))
    )
  );
  const cursor = input.cursor ? decodeBrowseCursor(input.cursor) : null;
  const now = ctx.clock.now();
  const conditions = [
    eq(adoptionListing.status, "published"),
    eq(directoryListing.status, "verified"),
    ...filterConditions(filters, now),
  ];
  if (cursor) {
    const after = or(
      lt(adoptionListing.publishedAt, cursor.publishedAt),
      and(
        eq(adoptionListing.publishedAt, cursor.publishedAt),
        lt(adoptionListing.id, cursor.id)
      )
    );
    if (after) conditions.push(after);
  }
  const rows = await selectJoined(ctx)
    .where(and(...conditions))
    .orderBy(desc(adoptionListing.publishedAt), desc(adoptionListing.id))
    .limit(ADOPTION_PAGE_SIZE + 1);
  const page = rows.slice(0, ADOPTION_PAGE_SIZE);
  const photos = await photosOf(
    ctx.db,
    page.map((row) => row.listing.id)
  );
  const last = page.at(-1);
  return {
    animals: page.map((row) =>
      cardOf(row, publicPhotosOf(photos.get(row.listing.id) ?? []), now)
    ),
    nextCursor:
      rows.length > ADOPTION_PAGE_SIZE && last?.listing.publishedAt
        ? encodeBrowseCursor({
            publishedAt: last.listing.publishedAt,
            id: last.listing.id,
          })
        : null,
  };
}

export type GetAdoptableAnimalResult =
  | { ok: true; animal: AdoptableAnimal }
  | { ok: false; error: "not_found" };

const slugInput = z.object({ slug: z.string().regex(ADOPTION_SLUG_PATTERN) });

/**
 * The animal with this slug, while its page is public: published, on hold
 * or adopted, under a verified directory listing.
 */
export async function getAdoptableAnimal(
  ctx: UseCaseContext,
  input: { slug: string }
): Promise<GetAdoptableAnimalResult> {
  await authorize(ctx, "adoption.listing.read_public");
  const parsed = slugInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "not_found" };
  const [row] = await selectJoined(ctx).where(
    and(
      eq(adoptionListing.slug, parsed.data.slug),
      inArray(adoptionListing.status, [...PUBLIC_STATUSES]),
      eq(directoryListing.status, "verified")
    )
  );
  const publishedAt = row?.listing.publishedAt;
  if (!row || !publishedAt) return { ok: false, error: "not_found" };
  const photos = publicPhotosOf(
    (await photosOf(ctx.db, [row.listing.id])).get(row.listing.id) ?? []
  );
  const { listing } = row;
  return {
    ok: true,
    animal: {
      ...cardOf(row, photos, ctx.clock.now()),
      breed: listing.breed,
      colour: listing.colour,
      about: listing.about,
      healthNotes: listing.healthNotes,
      vaccinationNotes: listing.vaccinationNotes,
      conditions: listing.conditions,
      pinCode: listing.pinCode,
      publishedAt,
      photos,
    },
  };
}

/** Every slug with a public page, for the proxy's 404s. */
export async function adoptableAnimalSlugs(
  ctx: UseCaseContext
): Promise<string[]> {
  await authorize(ctx, "adoption.listing.read_public");
  const rows = await ctx.db
    .select({ slug: adoptionListing.slug })
    .from(adoptionListing)
    .innerJoin(
      directoryListing,
      eq(directoryListing.id, adoptionListing.directoryListingId)
    )
    .where(
      and(
        inArray(adoptionListing.status, [...PUBLIC_STATUSES]),
        eq(directoryListing.status, "verified")
      )
    )
    .orderBy(adoptionListing.slug);
  return rows.map((row) => row.slug);
}
