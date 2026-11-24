// The listing form's fields, in form order (#127). On its own, so the
// browser's form loads it without the input schema.
//
// Loads anywhere: no imports.

export const LISTING_FIELDS = [
  "type",
  "name",
  "description",
  "services",
  "address",
  "city",
  "state",
  "pinCode",
  "contactPhone",
  "contactEmail",
  "website",
  "publicContactFields",
] as const;
