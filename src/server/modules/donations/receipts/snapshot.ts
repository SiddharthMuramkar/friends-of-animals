// A receipt as issued (#106). The capture transaction freezes every printed
// field into the receipt row, so the receipt page renders the same receipt
// for as long as it exists, whatever later happens to the organisation's
// facts, the donor's details or the wording. A layout change bumps
// RECEIPT_TEMPLATE_VERSION; issued receipts keep their own.
//
// No 80G block while `org.has80G` is off (HR-16): FOA issues receipts
// without tax-exemption wording until it holds the registration (#108 adds
// the block and the donor's PAN). The layout, the "no goods or services"
// line and the amount in words wait on the accountant (HR-47).
//
// Pure; loads under plain Node (the schema imports its type).

import type { OrgFacts } from "../../cms/domain/org-facts";
import { amountInWords } from "../domain/amount-in-words";
import type { DonorType } from "../domain/donor";

export const RECEIPT_TEMPLATE_VERSION = 1;

/** A fact as printed: its value, or null while FOA hadn't confirmed it. */
type PrintedFact = string | null;

export type ReceiptOrgFacts = {
  name: string;
  legalName: PrintedFact;
  address: PrintedFact;
  registration: {
    type: PrintedFact;
    number: PrintedFact;
    pan: PrintedFact;
  };
};

export type ReceiptSnapshot = {
  templateVersion: typeof RECEIPT_TEMPLATE_VERSION;
  number: string;
  /** The financial-year token, e.g. "2627". */
  fy: string;
  /** ISO 8601, UTC. */
  issuedAt: string;
  org: ReceiptOrgFacts;
  donor: {
    type: DonorType;
    /** The person's name, or the contact person's for an organisation. */
    name: string;
    /** On every corporate and CSR receipt, disclosed or not. */
    organisationName: string | null;
  };
  amount: {
    /** Paise, as a decimal string: JSON has no bigint. */
    minor: string;
    currency: "INR";
    inWords: string;
  };
  payment: { mode: "online"; reference: string };
  /** The 80G block; null while FOA has no 80G (HR-16). */
  taxExemption: null;
  /** Prints "No goods or services were provided in return" (HR-47). */
  noGoodsOrServices: true;
};

const printed = (fact: OrgFacts["legalName"]): PrintedFact =>
  typeof fact === "string" ? fact : null;

/** The organisation as a receipt issued now prints it. */
export function receiptOrgFacts(
  name: string,
  facts: OrgFacts
): ReceiptOrgFacts {
  return {
    name,
    legalName: printed(facts.legalName),
    address: printed(facts.address),
    registration: {
      type: printed(facts.registration.type),
      number: printed(facts.registration.number),
      pan: printed(facts.registration.pan),
    },
  };
}

export function buildReceiptSnapshot(input: {
  number: string;
  fy: string;
  issuedAt: Date;
  org: ReceiptOrgFacts;
  donor: ReceiptSnapshot["donor"];
  amountMinor: bigint;
  gatewayPaymentId: string;
}): ReceiptSnapshot {
  return {
    templateVersion: RECEIPT_TEMPLATE_VERSION,
    number: input.number,
    fy: input.fy,
    issuedAt: input.issuedAt.toISOString(),
    org: input.org,
    donor: input.donor,
    amount: {
      minor: input.amountMinor.toString(),
      currency: "INR",
      inWords: amountInWords({
        amountMinor: input.amountMinor,
        currency: "INR",
      }),
    },
    payment: { mode: "online", reference: input.gatewayPaymentId },
    taxExemption: null,
    noGoodsOrServices: true,
  };
}
