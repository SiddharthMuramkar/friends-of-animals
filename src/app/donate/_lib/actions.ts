"use server";

import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";

import { donationCheckoutPath } from "@/lib/app-routes";
import { as, currentActor } from "@/server/app";
import { errorSummaryForLogs } from "@/server/errors";
import type { StartDonationResult } from "@/server/modules/donations";

import {
  donationInputFrom,
  enteredFrom,
  type DonateField,
} from "./donate-input";
import type { DonateFormView } from "./form-state";
import { rupeesText } from "./rupees";

// The donate form's Server Action (#106): checks the form, starts the
// donation as whoever is on the site (signed in or not), and sends the
// donor to its checkout page with the donation's checkout token. A use
// case that throws is never shown to the donor: it is logged by class
// only, and the form says nothing was charged.

/** The use case's field names, as the form's. */
const FIELD_OF: Record<string, DonateField> = {
  amountMinor: "amount",
  donorType: "donorType",
  name: "name",
  email: "email",
  organisationName: "organisationName",
  wallName: "wallName",
};

export async function startDonationAction(
  previous: DonateFormView,
  formData: FormData
): Promise<DonateFormView> {
  const t = await getTranslations("donate.form");
  const entered = enteredFrom(formData);
  const view = (
    rest: Omit<DonateFormView, "attempt" | "entered" | "errors"> & {
      errors?: DonateFormView["errors"];
    }
  ): DonateFormView => ({
    attempt: previous.attempt + 1,
    entered,
    errors: {},
    ...rest,
  });
  const range = (min: bigint, max: bigint) => ({
    min: rupeesText(min),
    max: rupeesText(max),
  });
  const message = (field: DonateField, values?: { min: string; max: string }) =>
    field === "amount"
      ? t("errors.amount", values ?? range(10_000n, 10_000_000n))
      : t(`errors.${field}`);

  const parsed = donationInputFrom(entered);
  if (!parsed.ok) {
    return view({
      errors: Object.fromEntries(
        parsed.fields.map((field) => [field, message(field)])
      ),
    });
  }

  let result: StartDonationResult;
  try {
    result = await as(await currentActor()).startDonation(parsed.input);
  } catch (error) {
    console.error(`startDonation failed: ${errorSummaryForLogs(error)}`);
    return view({ alert: t("alerts.failed") });
  }
  if (result.ok) {
    redirect(donationCheckoutPath(result.donationId, result.checkoutToken));
  }
  switch (result.error) {
    case "invalid_input": {
      const fields = result.fields
        .map((name) => FIELD_OF[name])
        .filter((field): field is DonateField => field !== undefined);
      return fields.length > 0
        ? view({
            errors: Object.fromEntries(
              fields.map((field) => [field, message(field)])
            ),
          })
        : view({ alert: t("alerts.failed") });
    }
    case "amount_out_of_range":
      return view({
        errors: {
          amount: message(
            "amount",
            range(result.minAmountMinor, result.maxAmountMinor)
          ),
        },
      });
    case "disclosure_required":
      return view({ errors: { disclose: message("disclose") } });
    case "declaration_required":
      return view({ errors: { declarations: message("declarations") } });
    case "minor_must_ask_guardian":
      return view({ minor: t("alerts.minor_must_ask_guardian") });
    case "donations_closed":
    case "guests_not_allowed":
      return view({ alert: t(`alerts.${result.error}`) });
  }
}
