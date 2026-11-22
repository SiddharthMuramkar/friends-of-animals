// What the competition form shows after a save: the answers as they were
// typed, an alert for the whole form and a message against each field,
// already translated. Shared by the client form and the server actions.

import type { CompetitionFields } from "@/server/modules/competitions";

import type { FieldName } from "./form-view";

export type CompetitionFormView = {
  /** Goes up on every refused save, so the form re-reads `values`. */
  attempt: number;
  values: CompetitionFields;
  alert?: string;
  errors: Partial<Record<FieldName, string>>;
};
