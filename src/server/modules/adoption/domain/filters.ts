// The /adopt filters and pages (#129). Filters live in the query string so
// a filtered list can be shared and bookmarked. Anything the parser doesn't
// recognise is dropped, never an error: a stale or hand-edited link still
// shows animals. Pages are keyset cursors over (published_at, id), newest
// first, so a page never repeats or skips an animal when others are
// published in between.
//
// Pure: no I/O, no "server-only", no `@/` imports.

import { ADOPTION_AGE_BANDS, type AgeBand } from "./age";
import {
  ADOPTION_SPECIES,
  ADOPTION_TEXT_LIMITS,
  ANIMAL_SIZES,
  PIN_CODE_PATTERN,
  isIndianState,
  normalisePlainText,
  type AdoptionSpecies,
  type AnimalSize,
  type IndianState,
} from "./details";

export type AdoptionFilters = {
  species?: AdoptionSpecies;
  age?: AgeBand;
  /** "Unknown" is a fact about an animal, not something to filter for. */
  sex?: "female" | "male";
  size?: AnimalSize;
  state?: IndianState;
  /** Matched without case or extra spaces (see cityKey). */
  city?: string;
  pin?: string;
  /** Only animals known to be sterilised. */
  sterilised?: true;
};

export const ADOPTION_PAGE_SIZE = 24;

/** Next's `searchParams`: each key once, repeated, or absent. */
export type SearchParamsRecord = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function oneOf<T extends string>(
  options: readonly T[],
  value: string | undefined
): T | undefined {
  return value !== undefined && (options as readonly string[]).includes(value)
    ? (value as T)
    : undefined;
}

export function parseAdoptionFilters(
  params: SearchParamsRecord
): AdoptionFilters {
  const filters: AdoptionFilters = {};
  const species = oneOf(ADOPTION_SPECIES, first(params.species));
  if (species) filters.species = species;
  const age = oneOf(ADOPTION_AGE_BANDS, first(params.age));
  if (age) filters.age = age;
  const sex = oneOf(["female", "male"] as const, first(params.sex));
  if (sex) filters.sex = sex;
  const size = oneOf(ANIMAL_SIZES, first(params.size));
  if (size) filters.size = size;
  const state = first(params.state);
  if (state !== undefined && isIndianState(state)) filters.state = state;
  const city = normalisePlainText(first(params.city) ?? "", false).slice(
    0,
    ADOPTION_TEXT_LIMITS.cityMax
  );
  if (city) filters.city = city;
  const pin = first(params.pin)?.trim();
  if (pin !== undefined && PIN_CODE_PATTERN.test(pin)) filters.pin = pin;
  if (first(params.sterilised) === "yes") filters.sterilised = true;
  return filters;
}

/** The query string for `filters`, keys in one order (no leading "?"). */
export function filtersToSearchParams(filters: AdoptionFilters): string {
  const params = new URLSearchParams();
  if (filters.species) params.set("species", filters.species);
  if (filters.age) params.set("age", filters.age);
  if (filters.sex) params.set("sex", filters.sex);
  if (filters.size) params.set("size", filters.size);
  if (filters.state) params.set("state", filters.state);
  if (filters.city) params.set("city", filters.city);
  if (filters.pin) params.set("pin", filters.pin);
  if (filters.sterilised) params.set("sterilised", "yes");
  return params.toString();
}

/** How cities are compared: normalised, then lower-cased. */
export function cityKey(city: string): string {
  return normalisePlainText(city, false).toLocaleLowerCase("en-IN");
}

export type BrowseCursor = { publishedAt: Date; id: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The cursor after the last row of a page: opaque, URL-safe. */
export function encodeBrowseCursor({ publishedAt, id }: BrowseCursor): string {
  return Buffer.from(`${publishedAt.getTime()}.${id}`, "utf8").toString(
    "base64url"
  );
}

/** The cursor, or null (the first page) for anything malformed. */
export function decodeBrowseCursor(cursor: string): BrowseCursor | null {
  const decoded = Buffer.from(cursor, "base64url").toString("utf8");
  const match = /^(\d{1,15})\.(.+)$/.exec(decoded);
  if (!match || !UUID.test(match[2]!)) return null;
  const publishedAt = new Date(Number(match[1]));
  if (Number.isNaN(publishedAt.getTime())) return null;
  return { publishedAt, id: match[2]! };
}
