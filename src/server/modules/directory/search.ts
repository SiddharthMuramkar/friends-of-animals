// Search the directory (#128): verified listings offering a service within
// a radius of a pin code or the visitor's location, nearest first.
//
//   searchListings({ pin | lat+lng, service?, radius? })   (anyone)
//
// A listing sits at its pin code's centre (`pincode_location`), never at
// its address, so distances are approximate and shown that way. Distance
// is measured in plain SQL with the haversine formula on earthdistance's
// sphere: the earthdistance extension waits on HR-60, and PGlite would
// need it loaded too. A box on latitude and longitude narrows the rows
// first. ./domain/geo.ts holds the same maths in TypeScript.

import { and, asc, between, eq, sql } from "drizzle-orm";

import { authorize } from "../../access/can";
import { directoryListing, pincodeLocation } from "../../db/schema";
import type { UseCaseContext } from "../../use-cases";
import { DIRECTORY_SERVICES, type DirectoryService } from "./domain/catalogue";
import {
  approximateDistance,
  boxAround,
  EARTH_RADIUS_METRES,
  type ApproximateDistance,
  type GeoPoint,
} from "./domain/geo";
import { toPublicListing, type PublicListing } from "./domain/public-listing";
import {
  parseDirectorySearch,
  type RadiusKm,
  type SearchField,
  type SearchFieldError,
} from "./domain/search-input";
import { pincodeCentre } from "./pincodes";
import { storedListingOf } from "./stored-listing";

/** The query string's fields, as the /ngos search form sends them. */
export type SearchListingsInput = Partial<
  Record<"pin" | "lat" | "lng" | "service" | "radius", string | string[]>
>;

/** At most this many results, nearest first. */
export const SEARCH_RESULT_LIMIT = 50;

export type SearchResult = {
  listing: PublicListing;
  /** From the search's origin to the listing's pin-code centre. */
  distanceMetres: number;
  /** How the distance is shown: never more precise than a pin code. */
  distance: ApproximateDistance;
};

/** Where the search measured from. */
export type SearchedFrom =
  | ({
      kind: "pin";
      pinCode: string;
      district: string | null;
      state: string | null;
    } & GeoPoint)
  | ({ kind: "point" } & GeoPoint);

export type SearchListingsResult =
  | {
      ok: true;
      origin: SearchedFrom;
      service: DirectoryService | null;
      radiusKm: RadiusKm;
      results: SearchResult[];
      /** More listings are within the radius than the limit shows. */
      truncated: boolean;
    }
  | {
      ok: false;
      error: "invalid_input";
      fields: SearchField[];
      problems: Partial<Record<SearchField, SearchFieldError>>;
    }
  | { ok: false; error: "unknown_pin_code" };

const radians = (degrees: unknown) => sql`radians(${degrees})`;

/** Metres from `origin` to the listing's pin-code centre, in SQL. */
function distanceFrom(origin: GeoPoint) {
  const lat = sql`${origin.latitude}::double precision`;
  const lng = sql`${origin.longitude}::double precision`;
  const halfLat = sql`sin((${radians(pincodeLocation.latitude)} - ${radians(lat)}) / 2)`;
  const halfLng = sql`sin((${radians(pincodeLocation.longitude)} - ${radians(lng)}) / 2)`;
  return sql<number>`(2 * ${EARTH_RADIUS_METRES}::double precision * asin(least(1, sqrt(
    ${halfLat} * ${halfLat}
    + cos(${radians(lat)}) * cos(${radians(pincodeLocation.latitude)}) * ${halfLng} * ${halfLng}
  ))))`.mapWith(Number);
}

export async function searchListings(
  ctx: UseCaseContext,
  input: SearchListingsInput
): Promise<SearchListingsResult> {
  await authorize(ctx, "directory.read_public");
  const parsed = parseDirectorySearch(input, DIRECTORY_SERVICES);
  if (!parsed.ok) {
    return {
      ok: false,
      error: "invalid_input",
      fields: Object.keys(parsed.errors) as SearchField[],
      problems: parsed.errors,
    };
  }
  const { origin: from, service, radiusKm } = parsed.value;

  let origin: SearchedFrom;
  if (from.kind === "pin") {
    const centre = await pincodeCentre(ctx.db, from.pinCode);
    if (!centre) return { ok: false, error: "unknown_pin_code" };
    origin = { kind: "pin", ...centre };
  } else {
    origin = { kind: "point", ...from.point };
  }

  const radiusMetres = radiusKm * 1000;
  const box = boxAround(origin, radiusMetres);
  const metres = distanceFrom(origin);
  const rows = await ctx.db
    .select({ row: directoryListing, metres })
    .from(directoryListing)
    .innerJoin(
      pincodeLocation,
      eq(pincodeLocation.pinCode, directoryListing.pinCode)
    )
    .where(
      and(
        eq(directoryListing.status, "verified"),
        service === null
          ? undefined
          : sql`${directoryListing.services} @> ARRAY[${service}]::directory_service[]`,
        between(pincodeLocation.latitude, box.minLatitude, box.maxLatitude),
        between(pincodeLocation.longitude, box.minLongitude, box.maxLongitude),
        sql`${metres} <= ${radiusMetres}`
      )
    )
    .orderBy(asc(metres), asc(directoryListing.name), asc(directoryListing.id))
    .limit(SEARCH_RESULT_LIMIT + 1);

  const results: SearchResult[] = [];
  for (const { row, metres: distanceMetres } of rows.slice(
    0,
    SEARCH_RESULT_LIMIT
  )) {
    const listing = toPublicListing(storedListingOf(ctx, row));
    if (!listing) continue;
    results.push({
      listing,
      distanceMetres,
      distance: approximateDistance(distanceMetres),
    });
  }
  return {
    ok: true,
    origin,
    service,
    radiusKm,
    results,
    truncated: rows.length > SEARCH_RESULT_LIMIT,
  };
}
