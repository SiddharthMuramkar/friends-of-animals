// What a listing's representatives see of it (#129): every detail, its
// status and dates, and the age worked out from the clock. The
// `getAdoptionListingForOwner` use case authorizes the actor for the
// listing's directory listing (#59, #127), then reads through here.
//
// Loads under plain Node: relative imports only, no "server-only".

import { eq } from "drizzle-orm";

import type { AppDb } from "../../db/app-db";
import { adoptionListing } from "../../db/schema";
import type { Clock } from "../../ports/clock";
import type { EstimatedAge, YearMonth } from "./domain/age";
import type {
  AdoptionSpecies,
  AnimalSex,
  AnimalSize,
  IndianState,
} from "./domain/details";
import type { AdoptionListingStatus } from "./domain/status";
import { ageOf, stateOf } from "./rows";

export type OwnerAdoptionListing = {
  id: string;
  slug: string;
  directoryListingId: string;
  status: AdoptionListingStatus;
  name: string;
  species: AdoptionSpecies;
  breed: string | null;
  sex: AnimalSex;
  size: AnimalSize | null;
  colour: string | null;
  birthMonth: YearMonth;
  /** The age this month, from the birth month. */
  age: EstimatedAge;
  sterilised: boolean | null;
  about: string | null;
  healthNotes: string | null;
  vaccinationNotes: string | null;
  conditions: string;
  state: IndianState;
  city: string;
  pinCode: string;
  publishedAt: Date | null;
  closedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

/** The listing with id `listingId`, or null if there is none. */
export async function findAdoptionListingForOwner(
  { db, clock }: { db: AppDb; clock: Clock },
  listingId: string
): Promise<OwnerAdoptionListing | null> {
  const [row] = await db
    .select()
    .from(adoptionListing)
    .where(eq(adoptionListing.id, listingId));
  if (!row) return null;
  return {
    id: row.id,
    slug: row.slug,
    directoryListingId: row.directoryListingId,
    status: row.status,
    name: row.name,
    species: row.species,
    breed: row.breed,
    sex: row.sex,
    size: row.size,
    colour: row.colour,
    ...ageOf(row, clock.now()),
    sterilised: row.sterilised,
    about: row.about,
    healthNotes: row.healthNotes,
    vaccinationNotes: row.vaccinationNotes,
    conditions: row.conditions,
    state: stateOf(row),
    city: row.city,
    pinCode: row.pinCode,
    publishedAt: row.publishedAt,
    closedAt: row.closedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
