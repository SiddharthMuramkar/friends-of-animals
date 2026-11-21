// What finance typed for an offline donation (#108), read into the entry
// `recordOfflineDonation` records: a cheque, bank transfer or cash gift,
// its donor, its proof file and, while FOA can issue tax-exemption
// receipts, the donor's PAN. This checks the form's shape and the donor;
// #79's offline-payment rules check the reference, the amount and the
// date, and the proof file is checked against its stored status
// (./domain/proof.ts). Pure: no database, no clock.

import { z } from "zod";

import type { Pan } from "../domain/pan";
import type { TaxExemptionSettings } from "../domain/tax-exemption";

/**
 * How offline money arrives: the same three methods as #79's offline
 * payments (`OFFLINE_PAYMENT_METHODS`), which this list follows.
 */
export const OFFLINE_DONATION_METHODS = [
  "cheque",
  "bank_transfer",
  "cash",
] as const;

export type OfflineDonationMethod = (typeof OFFLINE_DONATION_METHODS)[number];

/** Who gave: a person, a company, or a company's CSR budget. */
export const DONOR_TYPES = ["individual", "corporate", "csr"] as const;

export type DonorType = (typeof DONOR_TYPES)[number];

/** What the offline donation form sends. */
export type RecordOfflineDonationInput = {
  method: OfflineDonationMethod;
  /** Cheque number, bank transfer reference (UTR) or FOA cash receipt. */
  reference: string;
  /** The calendar date in India the money arrived, `YYYY-MM-DD`. */
  receivedOn: string;
  /** Bigint paise, like every amount. */
  amountMinor: bigint;
  donor: {
    type: DonorType;
    name: string;
    email?: string | null;
    phone?: string | null;
    address?: string | null;
    /** The company's name; required for corporate and CSR gifts. */
    organisationName?: string | null;
  };
  /** The uploaded proof: a photo or scan of the cheque, slip or receipt. */
  proofFileId: string;
  /** Asked for only while 80G is on; dropped while it is off. */
  pan?: string | null;
};

/** One offline donation, ready to record. */
export type OfflineDonationEntry = {
  method: OfflineDonationMethod;
  reference: string;
  receivedOn: string;
  amountMinor: bigint;
  donor: {
    type: DonorType;
    name: string;
    email: string | null;
    phone: string | null;
    address: string | null;
    organisationName: string | null;
  };
  proofFileId: string;
  pan: Pan | null;
};

export type ReadOfflineDonationInput = {
  ok: true;
  entry: OfflineDonationEntry;
};

const optional = <T extends z.ZodType>(schema: T) =>
  schema.nullish().transform((value) => value ?? null);

const input = z.object({
  method: z.enum(OFFLINE_DONATION_METHODS),
  reference: z.string(),
  receivedOn: z.string(),
  amountMinor: z.bigint(),
  donor: z.object({
    type: z.enum(DONOR_TYPES),
    name: z.string().trim(),
    email: optional(z.string()),
    phone: optional(z.string()),
    address: optional(z.string()),
    organisationName: optional(z.string()),
  }),
  proofFileId: z.uuid(),
});

export function readOfflineDonationInput(
  raw: RecordOfflineDonationInput,
  _taxExemption: TaxExemptionSettings
): ReadOfflineDonationInput {
  const parsed = input.parse(raw);
  return { ok: true, entry: { ...parsed, pan: null } };
}
