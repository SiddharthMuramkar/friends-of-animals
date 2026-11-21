// The transparency read model (#110) in one call: the use case reads the
// locked months, the income and expense totals per month, and the donors'
// choices and donation legs, and this decides everything the page shows.
// Figures and names come from the same year and the same locked months, so
// a donor is never thanked for money the figures don't yet show. The impact
// page's funds raised is `fundsRaised(figures)` of this model.
// Pure; no imports beyond the domain helpers.

import {
  buildFigures,
  type AccountTotal,
  type Figures,
  type PublicAccount,
} from "./figures";
import {
  pickFinancialYear,
  publishedFinancialYears,
  type PeriodMonth,
} from "./financial-year";
import {
  buildRecognition,
  type DonationChoice,
  type DonationLeg,
  type Recognition,
} from "./recognition";

export type TransparencyInput = {
  /** The `?fy=` label asked for, e.g. "2025-26". */
  requestedFy?: string;
  /** Every locked (published) period month. */
  lockedMonths: readonly PeriodMonth[];
  accounts: readonly PublicAccount[];
  totals: readonly AccountTotal[];
  /** The income accounts that hold donations (net of refunds). */
  donationAccountCodes: ReadonlySet<string>;
  choices: readonly DonationChoice[];
  legs: readonly DonationLeg[];
};

export type Transparency =
  | { published: false }
  | {
      published: true;
      /** Every financial year with a locked month, newest first. */
      years: string[];
      figures: Figures;
      recognition: Recognition;
    };

export function buildTransparency(input: TransparencyInput): Transparency {
  const fy = pickFinancialYear(input.requestedFy, input.lockedMonths);
  if (fy === null) return { published: false };
  return {
    published: true,
    years: publishedFinancialYears(input.lockedMonths).map((y) => y.label),
    figures: buildFigures({
      fy,
      lockedMonths: input.lockedMonths,
      accounts: input.accounts,
      totals: input.totals,
      donationAccountCodes: input.donationAccountCodes,
    }),
    recognition: buildRecognition({
      fy,
      lockedMonths: input.lockedMonths,
      choices: input.choices,
      legs: input.legs,
    }),
  };
}
