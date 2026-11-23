import type { messages } from "@/i18n/messages";

export type LedgerErrorCode = keyof typeof messages.adminLedger.errors;

export type LedgerFormState = {
  error?: LedgerErrorCode;
  amountLine?: number;
  saved?: true;
};
export const initialFormState: LedgerFormState = {};
