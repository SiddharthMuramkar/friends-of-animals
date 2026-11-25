import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";

import { ADMIN_NEW_LEDGER_ENTRY } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";
import { istDateOf } from "@/server/modules/ledger/domain/period";

import { adminCall } from "../../../_lib/boundary";
import { LedgerDenied } from "../../_components/denied";
import { LedgerFrame } from "../../_components/frame";
import { ManualEntryForm } from "../../_components/manual-form";
import { ledgerFeedbackLabels, ledgerMetadata } from "../../_lib/copy";

export function generateMetadata() {
  return ledgerMetadata("manual");
}

export default async function Page() {
  const [actor, t] = await Promise.all([
    currentActor(),
    getTranslations("adminLedger"),
  ]);
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const accounts = await adminCall(
    () => as(actor).listLedgerAccounts(),
    ADMIN_NEW_LEDGER_ENTRY
  );
  if (!accounts.ok) return <LedgerDenied title={t("manual.title")} />;

  return (
    <LedgerFrame title={t("manual.title")} back={t("back")}>
      <ManualEntryForm
        today={istDateOf(new Date())}
        accounts={accounts.value
          .filter(({ isActive }) => isActive)
          .map(({ code, name }) => ({
            value: code,
            label: `${code} ${name}`,
          }))}
        labels={{
          date: t("manual.date"),
          description: t("manual.description"),
          line: t("manual.line"),
          account: t("manual.account"),
          chooseAccount: t("manual.chooseAccount"),
          side: t("manual.side"),
          chooseSide: t("manual.chooseSide"),
          debit: t("debit"),
          credit: t("credit"),
          amount: t("manual.amount"),
          memo: t("manual.memo"),
          add: t("manual.add"),
          remove: t("manual.remove"),
          submit: t("manual.submit"),
          saving: t("saving"),
          feedback: ledgerFeedbackLabels(t, [
            "forbidden",
            "invalid_input",
            "invalid_date",
            "future_date",
            "invalid_description",
            "invalid_memo",
            "too_few_lines",
            "too_many_lines",
            "unbalanced",
            "missing_account",
            "unknown_account",
            "inactive_account",
            "non_positive_amount",
            "invalid_amount",
            "amount_too_large",
            "period_locked",
          ]),
        }}
      />
    </LedgerFrame>
  );
}
