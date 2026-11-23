import "server-only";

import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import type { LedgerErrorCode } from "./form-state";

export async function ledgerMetadata(
  page: "list" | "detail" | "manual" | "accounts"
): Promise<Metadata> {
  const t = await getTranslations(`adminLedger.${page}`);
  return { title: t("title"), robots: { index: false, follow: false } };
}

export function ledgerFeedbackLabels(
  t: Awaited<ReturnType<typeof getTranslations<"adminLedger">>>,
  codes: readonly LedgerErrorCode[]
) {
  return {
    problem: t("problem"),
    errors: Object.fromEntries(
      codes.map((code) => [code, t(`errors.${code}`)])
    ),
  };
}
