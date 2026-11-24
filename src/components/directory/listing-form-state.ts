// The listing form's state between submissions (#127), shared by the
// register and edit pages: what was typed (the form resets after an
// action, so the inputs read it back), which fields the use case refused,
// and an alert for the whole form. Pure, so it loads in the client form
// and the Server Actions alike.

import { LISTING_FIELDS } from "@/server/modules/directory/domain/fields";
import type {
  ListingDetailsInput,
  ListingField,
} from "@/server/modules/directory/domain/listing-input";

export type ListingFormValues = {
  type: string;
  name: string;
  description: string;
  services: string[];
  address: string;
  city: string;
  state: string;
  pinCode: string;
  contactPhone: string;
  contactEmail: string;
  website: string;
  publicContactFields: string[];
};

export type ListingFormAlert =
  | "invalid_input"
  | "already_registered"
  | "listing_not_editable"
  | "unexpected";

export type ListingFormState = {
  /** Counts submissions, so the form remounts with the values below. */
  attempt: number;
  values: ListingFormValues;
  errors: ListingField[];
  alert?: ListingFormAlert;
};

export const EMPTY_LISTING: ListingFormValues = {
  type: "ngo",
  name: "",
  description: "",
  services: [],
  address: "",
  city: "",
  state: "",
  pinCode: "",
  contactPhone: "",
  contactEmail: "",
  website: "",
  publicContactFields: [],
};

/** A fresh form showing `values`. */
export function startWith(values: ListingFormValues): ListingFormState {
  return { attempt: 0, values, errors: [] };
}

function isField(name: string): name is ListingField {
  return (LISTING_FIELDS as readonly string[]).includes(name);
}

/** The form's fields as text; anything else the browser sends is ignored. */
export function valuesFrom(formData: FormData): ListingFormValues {
  const text = (name: string) => {
    const value = formData.get(name);
    return typeof value === "string" ? value : "";
  };
  const list = (name: string) =>
    formData
      .getAll(name)
      .filter((value): value is string => typeof value === "string");
  return {
    type: text("type"),
    name: text("name"),
    description: text("description"),
    services: list("services"),
    address: text("address"),
    city: text("city"),
    state: text("state"),
    pinCode: text("pinCode"),
    contactPhone: text("contactPhone"),
    contactEmail: text("contactEmail"),
    website: text("website"),
    publicContactFields: list("publicContactFields"),
  };
}

/** What the use case takes. */
export function detailsFrom(values: ListingFormValues): ListingDetailsInput {
  return { ...values };
}

/** The state after a submission that didn't go through. */
export function afterResult(
  previous: ListingFormState,
  values: ListingFormValues,
  result:
    | { ok: false; error: "invalid_input"; fields: string[] }
    | { ok: false; error: Exclude<ListingFormAlert, "invalid_input"> }
    | "unexpected"
): ListingFormState {
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
