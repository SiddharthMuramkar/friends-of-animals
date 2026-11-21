// How an adoption listing's details map to its columns and back. Shared by
// the writers (create, update) and the reads.
//
// Loads under plain Node: relative imports only, no "server-only".

import type { AdoptionListingRow } from "../../db/schema";
import {
  ageParts,
  estimateBirthMonth,
  fromDateColumn,
  toDateColumn,
  type EstimatedAge,
  type YearMonth,
} from "./domain/age";
import {
  isIndianState,
  type AdoptionListingDetails,
  type IndianState,
} from "./domain/details";
import { cityKey } from "./domain/filters";

/** The columns a listing's details fill, with the birth month for `now`. */
export function detailColumns(details: AdoptionListingDetails, now: Date) {
  return {
    name: details.name,
    species: details.species,
    breed: details.breed,
    sex: details.sex,
    size: details.size,
    colour: details.colour,
    birthMonth: toDateColumn(estimateBirthMonth(details.age, now)),
    sterilised: details.sterilised,
    about: details.about,
    healthNotes: details.healthNotes,
    vaccinationNotes: details.vaccinationNotes,
    conditions: details.conditions,
    state: details.state,
    city: details.city,
    cityKey: cityKey(details.city),
    pinCode: details.pinCode,
  } satisfies Partial<AdoptionListingRow>;
}

/** The state column, which a check constraint holds to INDIAN_STATES. */
export function stateOf(row: Pick<AdoptionListingRow, "id" | "state">) {
  if (!isIndianState(row.state)) {
    throw new Error(`Adoption listing ${row.id} has an unknown state`);
  }
  return row.state satisfies IndianState;
}

/** The birth month and the age it gives at `now`. */
export function ageOf(
  row: Pick<AdoptionListingRow, "birthMonth">,
  now: Date
): { birthMonth: YearMonth; age: EstimatedAge } {
  const birthMonth = fromDateColumn(row.birthMonth);
  return { birthMonth, age: ageParts(birthMonth, now) };
}
