import { getTranslations, getFormatter } from "next-intl/server";
import { redirect } from "next/navigation";
import { as, currentActor } from "@/server/app";
import { ROUTES } from "@/lib/routes";
import { ADMIN_RECURRING_DONATIONS } from "@/lib/app-routes";
import { adminCall } from "../../_lib/boundary";
import { DonationsDenied, DonationsFrame } from "../_components/frame";
import { formatPaise } from "@/server/modules/payments/domain/money-format";
import { CancelForm } from "@/app/dashboard/donations/_components/cancel-form";
import { canCancelRecurring } from "@/server/modules/donations/recurring/domain/recurring-status";

export const metadata = { robots: { index: false, follow: false } };
export default async function Page() {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const t = await getTranslations("donorDashboard");
  const format = await getFormatter();
  const found = await adminCall(
    () => as(actor).listRecurringDonations(),
    ADMIN_RECURRING_DONATIONS
  );
  if (!found.ok) return <DonationsDenied />;
  return (
    <DonationsFrame
      title={t("adminTitle")}
      lead={t("adminLead")}
      back={t("adminBack")}
    >
      {found.value.length ? (
        <ul className="space-y-4">
          {found.value.map((row) => (
            <li
              key={row.id}
              className="rounded-3xl border-2 border-border bg-surface p-5"
            >
              <h2 className="text-h3">
                {t("detail", { amount: formatPaise(row.amountMinor) })}
              </h2>
              <p className="text-sm text-ink-muted break-all">{row.id}</p>
              <p>
                {t("status")}:{" "}
                {row.cancelRequestedAt && canCancelRecurring(row.status)
                  ? t("pendingCancel")
                  : t(`statuses.${row.status}`)}
              </p>
              <p>
                {t("next")}:{" "}
                {row.nextChargeAt
                  ? format.dateTime(row.nextChargeAt, "long")
                  : t("none")}
              </p>
              {canCancelRecurring(row.status) && !row.cancelRequestedAt && (
                <div className="mt-4">
                  <CancelForm
                    id={row.id}
                    labels={{
                      cancel: t("cancel"),
                      title: t("confirmCancel"),
                      body: t("cancelBody"),
                      keep: t("keep"),
                      confirm: t("cancelConfirm"),
                      pending: t("submitting"),
                    }}
                  />
                </div>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p>{t("empty")}</p>
      )}
    </DonationsFrame>
  );
}
