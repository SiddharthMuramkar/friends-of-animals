import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";

import { SectionHeading } from "@/components/site/heading";
import { ADMIN_LEDGER_ACCOUNTS } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";
import {
  CATEGORY_KINDS,
  PUBLIC_GROUPS,
} from "@/server/modules/ledger/domain/chart";

import { adminCall } from "../../_lib/boundary";
import { CategoryForm } from "../_components/category-form";
import { LedgerDenied } from "../_components/denied";
import { LedgerFrame } from "../_components/frame";
import { ledgerFeedbackLabels, ledgerMetadata } from "../_lib/copy";

export function generateMetadata() {
  return ledgerMetadata("accounts");
}
const card = "rounded-3xl border-2 border-border bg-surface p-5 sm:p-6";

export default async function Page() {
  const [actor, t] = await Promise.all([
    currentActor(),
    getTranslations("adminLedger"),
  ]);
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const accounts = await adminCall(
    () => as(actor).listLedgerAccounts(),
    ADMIN_LEDGER_ACCOUNTS
  );
  if (!accounts.ok) return <LedgerDenied title={t("accounts.title")} />;

  const labels = {
    code: t("accounts.code"),
    codeHint: t("accounts.codeHint"),
    kind: t("accounts.kind"),
    chooseKind: t("accounts.chooseKind"),
    kinds: CATEGORY_KINDS.map((kind) => ({
      value: kind,
      label: t(`kinds.${kind}`),
    })),
    name: t("accounts.name"),
    publicLabel: t("accounts.publicLabel"),
    publicGroup: t("accounts.publicGroup"),
    chooseGroup: t("accounts.chooseGroup"),
    groups: PUBLIC_GROUPS.map((group) => ({
      value: group,
      label: t(`groups.${group}`),
    })),
    save: t("accounts.save"),
    create: t("accounts.create"),
    deactivate: t("accounts.deactivate"),
    saving: t("saving"),
    feedback: {
      saved: t("saved"),
      ...ledgerFeedbackLabels(t, [
        "forbidden",
        "kind_not_allowed",
        "invalid_code",
        "code_out_of_range",
        "code_taken",
        "invalid_name",
        "invalid_public_label",
        "invalid_public_group",
        "not_found",
        "system_account",
        "no_change",
      ]),
    },
  };

  return (
    <LedgerFrame title={t("accounts.title")} back={t("back")}>
      <section className={card} aria-labelledby="create-category">
        <SectionHeading
          id="create-category"
          title={t("accounts.createTitle")}
        />
        <CategoryForm headingId="create-category" labels={labels} />
      </section>
      <ul className="space-y-4">
        {accounts.value.map((account) => {
          if (account.kind !== "income" && account.kind !== "expense")
            return null;
          const id = `account-${account.code}`;
          return (
            <li key={account.code} className={card}>
              <SectionHeading id={id} title={account.name} />
              <p className="mt-2 text-ink-muted">
                {account.code} · {t(`kinds.${account.kind}`)}
                {account.isSystem ? ` · ${t("accounts.system")}` : ""}
                {account.isActive ? "" : ` · ${t("accounts.inactive")}`}
              </p>
              {account.isSystem ? null : (
                <CategoryForm
                  account={account}
                  headingId={id}
                  labels={labels}
                />
              )}
            </li>
          );
        })}
      </ul>
    </LedgerFrame>
  );
}
