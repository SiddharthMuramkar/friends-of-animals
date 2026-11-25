// How an adoption listing's details are stored and read back (#129). The
// form's estimated age becomes a birth month on the way in and an age
// again, as of now, on the way out; the city is kept as typed and as a
// key for the browse filter.
//
// Loads under plain Node (the seed script): relative imports only.

import type { AdoptionListingRow } from "../../db/schema";
import {
  ageParts,
  estimateBirthMonth,
  fromDateColumn,
  toDateColumn,
} from "./domain/age";
import type { AdoptionListingDetails, IndianState } from "./domain/details";
import { cityKey } from "./domain/filters";

/** The columns for `details`, as of `now`. */
export function detailsColumns(details: AdoptionListingDetails, now: Date) {
  const { age, ...rest } = details;
  return {
    ...rest,
    birthMonth: toDateColumn(estimateBirthMonth(age, now)),
    cityKey: cityKey(details.city),
  };
}

/** What the form shows of a stored listing, its age as of `now`. */
export function detailsOf(
  row: AdoptionListingRow,
  now: Date
): AdoptionListingDetails {
  return {
    name: row.name,
    species: row.species,
    breed: row.breed,
    sex: row.sex,
    size: row.size,
    colour: row.colour,
    age: ageParts(fromDateColumn(row.birthMonth), now),
    sterilised: row.sterilised,
    about: row.about,
    healthNotes: row.healthNotes,
    vaccinationNotes: row.vaccinationNotes,
    conditions: row.conditions,
    state: row.state as IndianState,
    city: row.city,
    pinCode: row.pinCode,
  };
}
