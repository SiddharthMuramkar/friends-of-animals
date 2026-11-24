// The animal form's state between submissions (#129), shared by the add
// and edit pages: what was typed (the form resets after an action, so the
// inputs read it back), which fields the use case refused, and an alert
// for the whole form. Pure, so it loads in the client form and the Server
// Actions alike.

import type {
  AdoptionListingDetails,
  AdoptionListingDetailsInput,
} from "@/server/modules/adoption/domain/details";

export const ANIMAL_FIELDS = [
  "name",
  "species",
  "breed",
  "sex",
  "size",
  "colour",
  "age",
  "sterilised",
  "about",
  "healthNotes",
  "vaccinationNotes",
  "conditions",
  "state",
  "city",
  "pinCode",
] as const;

export type AnimalField = (typeof ANIMAL_FIELDS)[number];

export type AnimalFormValues = {
  name: string;
  species: string;
  breed: string;
  sex: string;
  size: string;
  colour: string;
  ageYears: string;
  ageMonths: string;
  /** "yes", "no" or "unknown". */
  sterilised: string;
  about: string;
  healthNotes: string;
  vaccinationNotes: string;
  conditions: string;
  state: string;
  city: string;
  pinCode: string;
};

export type AnimalFormAlert =
  | "invalid_input"
  | "directory_not_verified"
  | "listing_closed"
  | "unexpected";

export type AnimalFormState = {
  /** Counts submissions, so the form remounts with the values below. */
  attempt: number;
  values: AnimalFormValues;
  errors: AnimalField[];
  alert?: AnimalFormAlert;
};

export const EMPTY_ANIMAL: AnimalFormValues = {
  name: "",
  species: "dog",
  breed: "",
  sex: "unknown",
  size: "",
  colour: "",
  ageYears: "",
  ageMonths: "",
  sterilised: "unknown",
  about: "",
  healthNotes: "",
  vaccinationNotes: "",
  conditions: "",
  state: "",
  city: "",
  pinCode: "",
};

/** A fresh form showing `values`. */
export function startWith(values: AnimalFormValues): AnimalFormState {
  return { attempt: 0, values, errors: [] };
}

/** The form's values for stored details. */
export function valuesOf(details: AdoptionListingDetails): AnimalFormValues {
  return {
    name: details.name,
    species: details.species,
    breed: details.breed ?? "",
    sex: details.sex,
    size: details.size ?? "",
    colour: details.colour ?? "",
    ageYears: String(details.age.years),
    ageMonths: String(details.age.months),
    sterilised:
      details.sterilised === null
        ? "unknown"
        : details.sterilised
          ? "yes"
          : "no",
    about: details.about ?? "",
    healthNotes: details.healthNotes ?? "",
    vaccinationNotes: details.vaccinationNotes ?? "",
    conditions: details.conditions,
    state: details.state,
    city: details.city,
    pinCode: details.pinCode,
  };
}

/** The form's fields as text; anything else the browser sends is ignored. */
export function valuesFrom(formData: FormData): AnimalFormValues {
  const text = (name: keyof AnimalFormValues) => {
    const value = formData.get(name);
    return typeof value === "string" ? value : "";
  };
  return Object.fromEntries(
    (Object.keys(EMPTY_ANIMAL) as (keyof AnimalFormValues)[]).map((key) => [
      key,
      text(key),
    ])
  ) as AnimalFormValues;
}

/** A whole number typed in a box, or NaN, which the use case refuses. */
function whole(text: string): number {
  const trimmed = text.trim();
  return /^\d{1,3}$/.test(trimmed) ? Number(trimmed) : Number.NaN;
}

/** What the use case takes. */
export function detailsFrom(
  values: AnimalFormValues
): AdoptionListingDetailsInput {
  return {
    name: values.name,
    species: values.species as AdoptionListingDetailsInput["species"],
    breed: values.breed,
    sex: values.sex as AdoptionListingDetailsInput["sex"],
    size:
      values.size === ""
        ? null
        : (values.size as NonNullable<AdoptionListingDetailsInput["size"]>),
    colour: values.colour,
    age: {
      years: whole(values.ageYears || "0"),
      months: whole(values.ageMonths || "0"),
    },
    sterilised:
      values.sterilised === "yes"
        ? true
        : values.sterilised === "no"
          ? false
          : null,
    about: values.about,
    healthNotes: values.healthNotes,
    vaccinationNotes: values.vaccinationNotes,
    conditions: values.conditions,
    state: values.state as AdoptionListingDetailsInput["state"],
    city: values.city,
    pinCode: values.pinCode,
  };
}

function isField(name: string): name is AnimalField {
  return (ANIMAL_FIELDS as readonly string[]).includes(name);
}

/** The state after a submission that didn't go through. */
export function afterResult(
  previous: AnimalFormState,
  values: AnimalFormValues,
  result:
    | { ok: false; error: "invalid_input"; fields: string[] }
    | { ok: false; error: Exclude<AnimalFormAlert, "invalid_input"> }
    | "unexpected"
): AnimalFormState {
  const attempt = previous.attempt + 1;
  if (result === "unexpected") {
    return { attempt, values, errors: [], alert: "unexpected" };
  }
  if (result.error === "invalid_input") {
    return {
      attempt,
      values,
      errors: result.fields.filter(isField),
      alert: "invalid_input",
    };
  }
  return { attempt, values, errors: [], alert: result.error };
}
