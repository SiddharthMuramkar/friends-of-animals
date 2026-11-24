import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";

import { FormAlert } from "@/components/form/form-alert";
import { TextField } from "@/components/form/text-field";
import { buttonStyles } from "@/components/site/button-link";
import { ADMIN_LEDGER_EXPORT, ADMIN_LEDGER_EXPORT_CSV } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";
import {
  financialYearMonths,
  istDateOf,
  periodMonthOf,
} from "@/server/modules/ledger/domain/period";

import { adminCall } from "../../_lib/boundary";
import { LedgerDenied } from "../_components/denied";
import { LedgerFrame } from "../_components/frame";
import { reportError } from "../_lib/report-outcome";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminLedgerReports.export");
  return { title: t("title"), robots: { index: false, follow: false } };
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export default async function Page({
  searchParams,
}: PageProps<"/admin/ledger/export">) {
  const [actor, t, ledger] = await Promise.all([
    currentActor(),
    getTranslations("adminLedgerReports"),
    getTranslations("adminLedger"),
  ]);
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  // Only finance may export; the page asks the ledger who may read it.
  const access = await adminCall(
    () => as(actor).listLedgerAccounts(),
    ADMIN_LEDGER_EXPORT
  );
  if (!access.ok) return <LedgerDenied title={t("export.title")} />;
  const search = await searchParams;
  const error = await reportError(search.error);
  const now = new Date();
  const from =
    typeof search.from === "string" && DATE.test(search.from)
      ? search.from
      : `${financialYearMonths(periodMonthOf(now))[0]}-01`;
  const to =
    typeof search.to === "string" && DATE.test(search.to)
      ? search.to
      : istDateOf(now);

  return (
    <LedgerFrame title={t("export.title")} back={ledger("back")}>
      {error ? (
        <FormAlert tone="danger" label={t("export.title")}>
          <p>{error}</p>
        </FormAlert>
      ) : null}
      <p className="max-w-prose">{t("export.lead")}</p>
      <p className="max-w-prose text-ink-muted">{t("export.provisional")}</p>
      <form action={ADMIN_LEDGER_EXPORT_CSV} method="get" className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            id="export-from"
            name="from"
            type="date"
            label={t("export.from")}
            hint={t("export.rangeHint")}
            defaultValue={from}
            required
          />
          <TextField
            id="export-to"
            name="to"
            type="date"
            label={t("export.to")}
            defaultValue={to}
            required
          />
        </div>
        <button type="submit" className={buttonStyles()}>
          {t("export.download")}
        </button>
      </form>
    </LedgerFrame>
  );
}
