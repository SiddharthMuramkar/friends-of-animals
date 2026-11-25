import { getTranslations, getFormatter } from "next-intl/server";
import { redirect, notFound } from "next/navigation";
import { Section } from "@/components/site/section";
import { PageHeader } from "@/components/site/heading";
import { SiteLink } from "@/components/site/site-link";
import { DASHBOARD_DONATIONS, monthlyCheckoutPath } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";
import { formatPaise } from "@/server/modules/payments/domain/money-format";
import { canCancelRecurring } from "@/server/modules/donations/recurring/domain/recurring-status";
import { CancelForm } from "../../_components/cancel-form";

export const metadata = { robots: { index: false, follow: false } };
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const { id } = await params;
  const found = await as(actor).getMyRecurringDonation({ id });
  if (!found.ok) notFound();
  const { recurring: row, charges } = found;
  const t = await getTranslations("donorDashboard");
  const format = await getFormatter();
  return (
    <Section hue="red" tone="tint" width="prose" className="pt-10 sm:pt-14">
      <PageHeader
        title={t("detail", { amount: formatPaise(row.amountMinor) })}
      />
      <div className="my-8 space-y-5">
        <p>
          <strong>{t("status")}: </strong>
          {row.cancelRequestedAt && canCancelRecurring(row.status)
            ? t("pendingCancel")
            : t(`statuses.${row.status}`)}
        </p>
        <p>
          <strong>{t("next")}: </strong>
          {row.nextChargeAt
            ? format.dateTime(row.nextChargeAt, "long")
            : t("none")}
        </p>
        {row.status === "pending_authorisation" && !row.cancelRequestedAt && (
          <a className="text-link underline" href={monthlyCheckoutPath(id)}>
            {t("authorise")}
          </a>
        )}
        {canCancelRecurring(row.status) && !row.cancelRequestedAt && (
          <div>
            <CancelForm
              id={id}
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
        <h2 className="text-h3">{t("charges")}</h2>
        {charges.length ? (
          <ul className="space-y-3">
            {charges.map((charge) => (
              <li
                key={charge.id}
                className="rounded-xl border border-border bg-surface p-4"
              >
                <p className="font-bold">{charge.receiptNumber}</p>
                <p>
                  {formatPaise(charge.amountMinor)}{" "}
                  {charge.capturedAt &&
                    format.dateTime(charge.capturedAt, "long")}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p>{t("noCharges")}</p>
        )}
        <SiteLink className="text-link underline" href={DASHBOARD_DONATIONS}>
          {t("back")}
        </SiteLink>
      </div>
    </Section>
  );
}
