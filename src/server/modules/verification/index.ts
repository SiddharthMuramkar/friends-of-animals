import type { UseCaseContext } from "../../use-cases";
import {
  forwardIndividualEntries,
  type ForwardIndividualEntriesInput,
} from "./forward-individual-entries";
import {
  listVerificationQueue,
  type ListVerificationQueueInput,
} from "./use-cases/list-verification-queue";
import {
  sendBackEntry,
  verifyEntry,
  type SendBackEntryInput,
  type VerifyEntryInput,
} from "./use-cases/decide-entry";
import { getVerificationEntry } from "./use-cases/get-verification-entry";
import {
  resubmitEntry,
  type ResubmitEntryInput,
} from "./use-cases/resubmit-entry";

export function verificationUseCases(ctx: UseCaseContext) {
  return {
    getVerificationEntry: (input: { entryId: string }) =>
      getVerificationEntry(ctx, input),
    forwardIndividualEntries: (input: ForwardIndividualEntriesInput) =>
      forwardIndividualEntries(ctx, input),
    listVerificationQueue: (input: ListVerificationQueueInput) =>
      listVerificationQueue(ctx, input),
    verifyEntry: (input: VerifyEntryInput) => verifyEntry(ctx, input),
    sendBackEntry: (input: SendBackEntryInput) => sendBackEntry(ctx, input),
    resubmitEntry: (input: ResubmitEntryInput) => resubmitEntry(ctx, input),
  };
}
