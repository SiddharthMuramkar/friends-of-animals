import "server-only";

import { getTranslations } from "next-intl/server";

import { LISTING_FIELDS } from "@/server/modules/directory/domain/fields";
import {
  DIRECTORY_SERVICES,
  LISTING_TYPES,
  PUBLIC_CONTACT_FIELDS,
} from "@/server/modules/directory/domain/catalogue";

import type { ListingFormLabels } from "./listing-form";

/** Fields whose label has a hint in messages/en-IN/directory.json. */
const HINTED = new Set<string>([
  "name",
  "description",
  "services",
  "address",
  "pinCode",
  "contactPhone",
  "publicContactFields",
]);

/** Every word the listing form shows, with its submit button's. */
export async function listingFormLabels(submit: {
  submit: string;
  submitting: string;
}): Promise<ListingFormLabels> {
  const [form, types, services, callout] = await Promise.all([
    getTranslations("directory.form"),
    getTranslations("directory.type"),
    getTranslations("directory.services"),
    getTranslations("common.callout"),
  ]);
  return {
    sections: {
      about: form("sections.about"),
      area: form("sections.area"),
      contact: form("sections.contact"),
      public: form("sections.public"),
    },
    fields: Object.fromEntries(
      LISTING_FIELDS.map((field) => [
        field,
        {
          label: form(`fields.${field}.label`),
          error: form(`fields.${field}.error`),
          ...(HINTED.has(field)
            ? {
                hint: form(
                  `fields.${field as "name"}.hint` as "fields.name.hint"
                ),
              }
            : {}),
        },
      ])
    ) as ListingFormLabels["fields"],
    types: Object.fromEntries(
      LISTING_TYPES.map((type) => [type, types(type)])
    ) as ListingFormLabels["types"],
    services: Object.fromEntries(
      DIRECTORY_SERVICES.map((service) => [service, services(service)])
    ) as ListingFormLabels["services"],
    publicContact: Object.fromEntries(
      PUBLIC_CONTACT_FIELDS.map((field) => [
        field,
        form(`publicContact.${field}`),
      ])
    ) as ListingFormLabels["publicContact"],
    alerts: {
      invalid_input: form("alerts.invalid_input"),
      already_registered: form("alerts.already_registered"),
      listing_not_editable: form("alerts.listing_not_editable"),
      unexpected: form("alerts.unexpected"),
    },
    ...submit,
    problem: callout("danger"),
  };
}
