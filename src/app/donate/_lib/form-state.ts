// What the donate form shows after each try (#106): what was typed, a
// message per field, an alert for the whole form, or the minor's stop.
// Every message comes translated from the action, so the island ships no
// catalogue. Pure types and a start value.

import {
  EMPTY_DONATION,
  type DonateEntered,
  type DonateField,
} from "./donate-input";

export type DonateFormView = {
  /** Counts tries, so the form remounts showing what was typed. */
  attempt: number;
  entered: DonateEntered;
  errors: Partial<Record<DonateField, string>>;
  alert?: string;
  /** A signed-in minor: the form gives way to "ask a grown-up". */
  minor?: string;
};

export const START_VIEW: DonateFormView = {
  attempt: 0,
  entered: EMPTY_DONATION,
  errors: {},
};
