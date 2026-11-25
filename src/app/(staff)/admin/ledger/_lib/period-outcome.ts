import { getTranslations } from "next-intl/server";

import messages from "../../../../../../messages/en-IN/adminLedgerPeriods.json";

type ErrorCode = keyof typeof messages.adminLedgerPeriods.errors;
type ResultCode = keyof typeof messages.adminLedgerPeriods.results;

/** What a period or approval action did, carried back in the address. */
export type PeriodOutcome = { error: string } | { done: ResultCode };

const isErrorCode = (code: string): code is ErrorCode =>
  Object.hasOwn(messages.adminLedgerPeriods.errors, code);

export function periodOutcomeHref(path: string, outcome: PeriodOutcome) {
  const code =
    "done" in outcome
      ? outcome.done
      : isErrorCode(outcome.error)
        ? outcome.error
        : "invalid_input";
  return `${path}?${new URLSearchParams({ done: code }).toString()}`;
}

/** The notice for `?done=`, or null when there is none to show. */
export async function periodNotice({
  done,
}: Record<string, string | string[] | undefined>) {
  if (typeof done !== "string") return null;
  const t = await getTranslations("adminLedgerPeriods");
  if (isErrorCode(done)) {
    return { tone: "danger" as const, message: t(`errors.${done}`) };
  }
  if (Object.hasOwn(messages.adminLedgerPeriods.results, done)) {
    return {
      tone: "success" as const,
      message: t(`results.${done as ResultCode}`),
    };
  }
  return null;
}
