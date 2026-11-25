// What the donate form posts (#106), read into what startDonation takes,
// and what the form shows back. Pure, so the server action and its test
// share it without a page.

import type { StartDonationInput } from "@/server/modules/donations";

/** The amounts offered as chips, in whole rupees (HR-51 confirms them). */
export const PRESET_RUPEES = [500, 1000, 2500, 5000] as const;

/** Rupees, with at most two decimals (paise), digits only. */
const RUPEES = /^(\d+)(?:\.(\d{1,2}))?$/;

/**
 * The paise in an amount a donor typed in rupees, or null if it isn't one.
 * Forgives what people type: spaces, a leading ₹, and digit-group commas
 * in either style (1,00,000 or 100,000). Zero reads as zero; the use case
 * refuses it.
 */
export function rupeesToPaise(typed: string): bigint | null {
  const digits = typed.trim().replace(/^₹\s*/, "").replaceAll(",", "");
  const match = RUPEES.exec(digits);
  if (!match) return null;
  const [, rupees, paise = ""] = match;
  return BigInt(rupees!) * 100n + BigInt(paise.padEnd(2, "0"));
}

export type DonateField =
  | "amount"
  | "donorType"
  | "name"
  | "email"
  | "organisationName"
  | "disclose"
  | "wallName"
  | "declarations";

/** The form as typed, to show it again after a refusal. */
export type DonateEntered = {
  amount: string;
  otherAmount: string;
  donorType: string;
  name: string;
  email: string;
  organisationName: string;
  disclose: string;
  showOnWall: boolean;
  wallName: string;
  declaredAdult: boolean;
  declaredIndianSource: boolean;
};

export const EMPTY_DONATION: DonateEntered = {
  amount: "",
  otherAmount: "",
  donorType: "individual",
  name: "",
  email: "",
  organisationName: "",
  disclose: "",
  showOnWall: false,
  wallName: "",
  declaredAdult: false,
  declaredIndianSource: false,
};

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

/** The fields as typed; a missing field or a file reads as blank. */
export function enteredFrom(formData: FormData): DonateEntered {
  return {
    amount: text(formData, "amount"),
    otherAmount: text(formData, "otherAmount"),
    donorType: text(formData, "donorType") || "individual",
    name: text(formData, "name"),
    email: text(formData, "email"),
    organisationName: text(formData, "organisationName"),
    disclose: text(formData, "disclose"),
    showOnWall: formData.get("showOnWall") === "on",
    wallName: text(formData, "wallName"),
    declaredAdult: formData.get("declaredAdult") === "on",
    declaredIndianSource: formData.get("declaredIndianSource") === "on",
  };
}

/** The amount chosen: a chip's rupees, or the other amount typed. */
export function amountOf(entered: DonateEntered): bigint | null {
  if (entered.amount === "other") return rupeesToPaise(entered.otherAmount);
  const preset = PRESET_RUPEES.find((each) => String(each) === entered.amount);
  return preset === undefined ? null : BigInt(preset) * 100n;
}

/**
 * The use case's input, or the fields the form must ask for again before
 * anything is sent. The use case checks everything once more.
 */
export function donationInputFrom(
  entered: DonateEntered
):
  | { ok: true; input: StartDonationInput }
  | { ok: false; fields: DonateField[] } {
  const fields: DonateField[] = [];
  const amountMinor = amountOf(entered);
  if (amountMinor === null || amountMinor <= 0n) fields.push("amount");
  const organisation = entered.donorType !== "individual";
  if (!entered.name.trim()) fields.push("name");
  if (!entered.email.trim()) fields.push("email");
  if (organisation && !entered.organisationName.trim()) {
    fields.push("organisationName");
  }
  if (organisation && entered.disclose !== "yes" && entered.disclose !== "no") {
    fields.push("disclose");
  }
  if (!entered.declaredAdult || !entered.declaredIndianSource) {
    fields.push("declarations");
  }
  if (fields.length > 0 || amountMinor === null) return { ok: false, fields };
  return {
    ok: true,
    input: {
      amountMinor,
      donorType: entered.donorType,
      name: entered.name,
      email: entered.email,
      ...(organisation
        ? {
            organisationName: entered.organisationName,
            discloseOrganisation: entered.disclose === "yes",
          }
        : {}),
      showOnWall: entered.showOnWall,
      ...(entered.showOnWall && entered.wallName.trim()
        ? { wallName: entered.wallName }
        : {}),
      declaredAdult: entered.declaredAdult,
      declaredIndianSource: entered.declaredIndianSource,
    },
  };
}
