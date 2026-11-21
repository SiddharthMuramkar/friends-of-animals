// A receipt as issued (#106). The capture transaction freezes every printed
// field into the receipt row, so the receipt page (106b) renders the same
// receipt for as long as it exists, whatever later happens to the
// organisation's facts, the donor's details or the wording. A layout change
// bumps RECEIPT_TEMPLATE_VERSION; issued receipts keep their own.
//
// No 80G block while `org.has80G` is off (HR-16): FOA issues receipts
// without tax-exemption wording until it holds the registration. The
// layout, the "no goods or services" line and the amount in words wait on
// the accountant (HR-47). Pure; loads under plain Node.

import { SITE, type OrgFact } from "../../../../lib/site";
import { amountInWords } from "../domain/amount-in-words";
import type { DonorType } from "../domain/donor";

export const RECEIPT_TEMPLATE_VERSION = 1;

/**
 * The organisation as the receipt prints it. Facts FOA hasn't confirmed
 * stay placeholders (rendered visibly); production refuses to start with
 * any left (`assertNoPlaceholdersInProduction`).
 */
export type ReceiptOrgFacts = {
  name: string;
  legalName: OrgFact;
  address: OrgFact;
  registration: { type: OrgFact; number: OrgFact; pan: OrgFact };
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

/** The organisation's facts as they stand now, for a receipt issued now. */
export function currentReceiptOrgFacts(): ReceiptOrgFacts {
  const { org } = SITE;
  return {
    name: SITE.name,
    legalName: org.legalName,
    address: org.address,
    registration: {
      type: org.registration.type,
      number: org.registration.number,
      pan: org.registration.pan,
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
      inWords: amountInWords({ amountMinor: input.amountMinor, currency: "INR" }),
    },
    payment: { mode: "online", reference: input.gatewayPaymentId },
    taxExemption: null,
    noGoodsOrServices: true,
  };
}
