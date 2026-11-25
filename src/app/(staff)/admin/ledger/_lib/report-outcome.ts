import { getTranslations } from "next-intl/server";

import messages from "../../../../../../messages/en-IN/adminLedgerReports.json";

type ErrorCode = keyof typeof messages.adminLedgerReports.errors;

const isErrorCode = (code: string): code is ErrorCode =>
  Object.hasOwn(messages.adminLedgerReports.errors, code);

/** The danger notice for `?error=` on a budget or export page, or null. */
export async function reportError(code: string | string[] | undefined) {
  if (typeof code !== "string" || !isErrorCode(code)) return null;
  const t = await getTranslations("adminLedgerReports");
  return t(`errors.${code}`);
}

/** Where a budget form comes back to, with its outcome code. */
export function budgetOutcomeHref(
  path: string,
  query: Record<string, string>,
  outcome: { done: "budget_saved" } | { error: string }
) {
  const search = new URLSearchParams(query);
  if ("done" in outcome) search.set("done", outcome.done);
  else
    search.set(
      "error",
      isErrorCode(outcome.error) ? outcome.error : "invalid_input"
    );
  return `${path}?${search.toString()}`;
}
