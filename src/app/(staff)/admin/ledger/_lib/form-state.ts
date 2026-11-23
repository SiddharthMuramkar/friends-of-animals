import type { copy } from "./copy";

type ErrorCode = keyof typeof copy.errors;

export type LedgerFormState = { error?: ErrorCode; saved?: true };
export const initialFormState: LedgerFormState = {};
