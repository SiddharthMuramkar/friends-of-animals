// The donations module (#106): one-time online donations in INR with
// sequential receipts behind 7-day links. Its use cases join `as(actor)`
// through `donationsUseCases`. Payments carries the money (a payment batch
// of purpose `donation`, ../payments/purposes.ts) and the ledger posts it
// (../ledger/sources/donations.ts). The pages are /donate, its checkout
// and thank-you pages, /receipts and /admin/donations.
//
// Seams for what builds on it: recurring donations (#107) and offline
// donations (#108) start donations with their own `origin` (every status
// and origin is in the first migration) and capture them through the same
// receipt numbering (./receipts/issue.ts); 80G and PAN (#108) add the
// receipt's tax block and the donor's PAN; the transparency page (#110)
// reads the ledger's donation accounts and `donor.disclose_organisation`.

import type { UseCaseContext } from "../../use-cases";
import {
  getDonation,
  listDonations,
  requestDonationRefund,
  type GetDonationInput,
  type ListDonationsInput,
  type RequestDonationRefundInput,
} from "./admin";
import {
  confirmDonationCheckout,
  payDonationTestCheckout,
  payForDonation,
  type ConfirmDonationCheckoutInput,
  type PayDonationTestCheckoutInput,
  type PayForDonationInput,
} from "./checkout";
import { expirePendingDonations } from "./expire";
import { getDonationOutcome, type GetDonationOutcomeInput } from "./outcome";
import {
  getReceiptByToken,
  reissueReceiptLink,
  requestReceiptLinkByEmail,
  type GetReceiptByTokenInput,
  type ReissueReceiptLinkInput,
  type RequestReceiptLinkByEmailInput,
} from "./receipt-links";
import { startDonation, type StartDonationInput } from "./start-donation";
import { recurringUseCases } from "./recurring";
import { getDonationTerms } from "./terms";

export type * from "./admin";
export type * from "./checkout";
export type * from "./expire";
export type * from "./outcome";
export type * from "./receipt-links";
export type * from "./start-donation";
export type * from "./terms";
export type { DonationStatus } from "./domain/donation-status";
export type { DonorType } from "./domain/donor";
export type { ReceiptSnapshot } from "./receipts/snapshot";

export const donationsUseCases = (ctx: UseCaseContext) => ({
  ...recurringUseCases(ctx),
  getDonationTerms: () => getDonationTerms(ctx),
  startDonation: (input: StartDonationInput) => startDonation(ctx, input),
  payForDonation: (input: PayForDonationInput) => payForDonation(ctx, input),
  confirmDonationCheckout: (input: ConfirmDonationCheckoutInput) =>
    confirmDonationCheckout(ctx, input),
  payDonationTestCheckout: (input: PayDonationTestCheckoutInput) =>
    payDonationTestCheckout(ctx, input),
  getDonationOutcome: (input: GetDonationOutcomeInput) =>
    getDonationOutcome(ctx, input),
  getReceiptByToken: (input: GetReceiptByTokenInput) =>
    getReceiptByToken(ctx, input),
  reissueReceiptLink: (input: ReissueReceiptLinkInput) =>
    reissueReceiptLink(ctx, input),
  requestReceiptLinkByEmail: (input: RequestReceiptLinkByEmailInput) =>
    requestReceiptLinkByEmail(ctx, input),
  listDonations: (input?: ListDonationsInput) => listDonations(ctx, input),
  getDonation: (input: GetDonationInput) => getDonation(ctx, input),
  requestDonationRefund: (input: RequestDonationRefundInput) =>
    requestDonationRefund(ctx, input),
  expirePendingDonations: () => expirePendingDonations(ctx),
});
