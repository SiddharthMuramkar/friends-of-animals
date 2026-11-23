import type { UseCaseContext } from "../../use-cases";

import {
  createLedgerAccount,
  deactivateLedgerAccount,
  updateLedgerAccount,
  type CreateLedgerAccountInput,
  type UpdateLedgerAccountInput,
} from "./accounts";
import { backfillLedgerFromPayments } from "./backfill";
import { postPaymentCapture, postRefund } from "./consumers";
import { createManualEntry, type ManualEntryInput } from "./manual-entry";
import {
  getPosting,
  listLedgerAccounts,
  listPostings,
  type ListPostingsInput,
} from "./queries";
import { reversePosting } from "./reverse";

export { postToLedger } from "./post";
export { ledgerTrialBalance } from "./queries";

export const ledgerUseCases = (ctx: UseCaseContext) => ({
  postPaymentCapture: (input: { batchId: string }) =>
    postPaymentCapture(ctx, input),
  postRefund: (input: { refundId: string }) => postRefund(ctx, input),
  backfillLedgerFromPayments: () => backfillLedgerFromPayments(ctx),
  createManualEntry: (input: ManualEntryInput) => createManualEntry(ctx, input),
  reversePosting: (seq: string | bigint) => reversePosting(ctx, seq),
  createLedgerAccount: (input: CreateLedgerAccountInput) =>
    createLedgerAccount(ctx, input),
  updateLedgerAccount: (input: UpdateLedgerAccountInput) =>
    updateLedgerAccount(ctx, input),
  deactivateLedgerAccount: (input: { code: string }) =>
    deactivateLedgerAccount(ctx, input),
  listPostings: (input: ListPostingsInput) => listPostings(ctx, input),
  getPosting: (seq: string | bigint) => getPosting(ctx, seq),
  listLedgerAccounts: () => listLedgerAccounts(ctx),
});
