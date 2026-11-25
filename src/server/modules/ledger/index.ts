import type { UseCaseContext } from "../../use-cases";

import {
  createLedgerAccount,
  deactivateLedgerAccount,
  updateLedgerAccount,
  type CreateLedgerAccountInput,
  type UpdateLedgerAccountInput,
} from "./accounts";
import {
  approveFinanceRequest,
  cancelFinanceRequest,
  expireFinanceRequests,
  listFinanceRequests,
  rejectFinanceRequest,
} from "./approvals";
import { backfillLedgerFromPayments } from "./backfill";
import { budgetVsActual, setBudget } from "./budgets";
import { postPaymentCapture, postRefund } from "./consumers";
import { exportLedger } from "./export";
import { createManualEntry, type ManualEntryInput } from "./manual-entry";
import {
  getPosting,
  listLedgerAccounts,
  listPostings,
  type ListPostingsInput,
} from "./queries";
import {
  listLedgerPeriods,
  requestPeriodLock,
  requestPeriodUnlock,
} from "./periods";
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
  // Period lock and the two-approver rule (#109).
  listLedgerPeriods: () => listLedgerPeriods(ctx),
  requestPeriodLock: (input: { month: string }) =>
    requestPeriodLock(ctx, input),
  requestPeriodUnlock: (input: { month: string; reason: string }) =>
    requestPeriodUnlock(ctx, input),
  listFinanceRequests: () => listFinanceRequests(ctx),
  approveFinanceRequest: (input: { requestId: string }) =>
    approveFinanceRequest(ctx, input),
  rejectFinanceRequest: (input: { requestId: string; reason: string }) =>
    rejectFinanceRequest(ctx, input),
  cancelFinanceRequest: (input: { requestId: string }) =>
    cancelFinanceRequest(ctx, input),
  expireFinanceRequests: () => expireFinanceRequests(ctx),
  // Budgets and the accountant's export (#109).
  setBudget: (input: {
    accountCode: string;
    periodMonth: string;
    amount: string;
  }) => setBudget(ctx, input),
  budgetVsActual: (input?: { from?: string; to?: string }) =>
    budgetVsActual(ctx, input),
  exportLedger: (input: { from: string; to: string }) =>
    exportLedger(ctx, input),
});
