import "server-only";

import { getTranslations } from "next-intl/server";

import {
  ADOPTION_SPECIES,
  ANIMAL_SEXES,
  ANIMAL_SIZES,
  INDIAN_STATES,
} from "@/server/modules/adoption/domain/details";

import { ANIMAL_FIELDS } from "../_lib/form-state";
import type { AnimalFormLabels } from "./animal-form";

/** Fields whose label has a hint in messages/en-IN/adoption.json. */
const HINTED = new Set<string>(["age", "about", "conditions"]);

/** Every word the animal form shows, with its submit button's. */
export async function animalFormLabels(submit: {
  submit: string;
  submitting: string;
}): Promise<AnimalFormLabels> {
  const [form, species, sex, size, sterilised, callout] = await Promise.all([
    getTranslations("adoption.manage.form"),
    getTranslations("adoption.species"),
    getTranslations("adoption.sex"),
    getTranslations("adoption.size"),
    getTranslations("adoption.sterilised"),
    getTranslations("common.callout"),
  ]);
  const fields = Object.fromEntries(
    ANIMAL_FIELDS.map((field) => [
      field,
      {
        label: form(`fields.${field}.label`),
        error: form(`fields.${field}.error`),
        ...(HINTED.has(field)
          ? { hint: form(`fields.${field as "age"}.hint`) }
          : {}),
      },
    ])
  ) as AnimalFormLabels["fields"];
  fields.age = {
    ...fields.age,
    years: form("fields.age.years"),
    months: form("fields.age.months"),
  };
  return {
    sections: {
      animal: form("sections.animal"),
      health: form("sections.health"),
      adoption: form("sections.adoption"),
      place: form("sections.place"),
    },
    fields,
    options: {
      species: ADOPTION_SPECIES.map((value) => ({
        value,
        label: species(value),
      })),
      sex: ANIMAL_SEXES.map((value) => ({ value, label: sex(value) })),
      size: [
        { value: "", label: form("sizeNone") },
        ...ANIMAL_SIZES.map((value) => ({ value, label: size(value) })),
      ],
      sterilised: (["unknown", "yes", "no"] as const).map((value) => ({
        value,
        label: sterilised(value),
      })),
      state: [
        { value: "", label: form("statePlaceholder") },
        ...INDIAN_STATES.map((state) => ({
          value: state.key,
          label: state.name,
        })),
      ],
    },
    alerts: {
      invalid_input: form("alerts.invalid_input"),
      directory_not_verified: form("alerts.directory_not_verified"),
      listing_closed: form("alerts.listing_closed"),
      unexpected: form("alerts.unexpected"),
    },
    ...submit,
    problem: callout("danger"),
  };
}
