import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";

import { SubmitButton } from "@/components/form/submit-button";
import { TextAreaField } from "@/components/form/text-area-field";
import { SiteLink } from "@/components/site/site-link";
import { ADMIN_LEDGER_APPROVALS, ADMIN_LEDGER_PERIODS } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";

import { adminCall } from "../../_lib/boundary";
import { LedgerDenied } from "../_components/denied";
import { LedgerFrame } from "../_components/frame";
import { PeriodOutcomeNotice } from "../_components/period-notice";
import { monthLabel } from "../_lib/month";
import { requestLockAction, requestUnlockAction } from "../_lib/period-actions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminLedgerPeriods.periods");
  return { title: t("title"), robots: { index: false, follow: false } };
}

const link = "inline-flex min-h-11 items-center text-link underline";

export default async function Page({
  searchParams,
}: PageProps<"/admin/ledger/periods">) {
  const [actor, t, ledger, format] = await Promise.all([
    currentActor(),
    getTranslations("adminLedgerPeriods"),
    getTranslations("adminLedger"),
    getFormatter(),
  ]);
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const result = await adminCall(
    () => as(actor).listLedgerPeriods(),
    ADMIN_LEDGER_PERIODS
  );
  if (!result.ok) return <LedgerDenied title={t("periods.title")} />;
  const view = result.value;

  return (
    <LedgerFrame title={t("periods.title")} back={ledger("back")}>
      <PeriodOutcomeNotice search={await searchParams} />
      <p className="max-w-prose">{t("periods.lead")}</p>
      <p className="font-semibold">
        {view.lockLine
          ? t("periods.lockLine", { month: monthLabel(format, view.lockLine) })
          : t("periods.noLock")}
      </p>
      <p className="max-w-prose text-ink-muted">
        {t("periods.lateAdjustments")}
      </p>
      <ul
        aria-label={t("periods.caption")}
        className="divide-y divide-border rounded-2xl border border-border bg-surface"
      >
        {view.periods.map((period) => {
          const month = monthLabel(format, period.month);
          return (
            <li key={period.month} className="space-y-3 p-4 sm:p-6">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h2 className="text-lead font-semibold">{month}</h2>
                <span className="text-ink-muted">
                  {t(`periods.status.${period.status}`)}
                </span>
              </div>
              {period.lockedAt ? (
                <p className="text-ink-muted">
                  {t("periods.lockedOn", {
                    date: format.dateTime(period.lockedAt, "long"),
                  })}
                </p>
              ) : null}
              {period.lastUnlockedAt && period.lastUnlockReason ? (
                <p className="text-ink-muted wrap-anywhere">
                  {t("periods.unlockedOn", {
                    date: format.dateTime(period.lastUnlockedAt, "long"),
                    reason: period.lastUnlockReason,
                  })}
                </p>
              ) : null}
              {period.pendingRequest ? (
                <p>
                  {period.pendingRequest.operation === "period_unlock"
                    ? t("periods.pending.period_unlock")
                    : t("periods.pending.period_lock")}{" "}
                  <SiteLink href={ADMIN_LEDGER_APPROVALS} className={link}>
                    {t("periods.seeRequest")}
                  </SiteLink>
                </p>
              ) : null}
              {period.canRequestLock ? (
                <form action={requestLockAction}>
                  <input type="hidden" name="month" value={period.month} />
                  <SubmitButton
                    variant="secondary"
                    pendingLabel={t("periods.sending")}
                  >
                    {t("periods.requestLock", { month })}
                  </SubmitButton>
                </form>
              ) : null}
              {period.canRequestUnlock ? (
                <form action={requestUnlockAction} className="space-y-3">
                  <input type="hidden" name="month" value={period.month} />
                  <TextAreaField
                    id={`unlock-reason-${period.month}`}
                    name="reason"
                    label={t("periods.unlockReason", { month })}
                    hint={t("periods.unlockHint")}
                    rows={2}
                    maxLength={500}
                    required
                  />
                  <SubmitButton
                    variant="secondary"
                    pendingLabel={t("periods.sending")}
                  >
                    {t("periods.requestUnlock", { month })}
                  </SubmitButton>
                </form>
              ) : null}
            </li>
          );
        })}
      </ul>
    </LedgerFrame>
  );
}
