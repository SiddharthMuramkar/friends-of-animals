import { getTranslations, getFormatter } from "next-intl/server";
import { redirect } from "next/navigation";
import { Section } from "@/components/site/section";
import { PageHeader } from "@/components/site/heading";
import { SiteLink } from "@/components/site/site-link";
import { APP_ROUTES, recurringDonationPath } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";
import { formatPaise } from "@/server/modules/payments/domain/money-format";
import { StartForm } from "./_components/start-form";

export const metadata = { robots: { index: false, follow: false } };
export default async function Page() {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const t = await getTranslations("donorDashboard");
  const format = await getFormatter();
  const [rows, terms] = await Promise.all([
    as(actor).listMyRecurringDonations(),
    as(actor).getDonationTerms(),
  ]);
  return (
    <Section hue="red" tone="tint" width="prose" className="pt-10 sm:pt-14">
      <PageHeader title={t("title")} lead={t("lead")} />
      <div className="my-8 space-y-5">
        {rows.length ? (
          <ul className="space-y-4">
            {rows.map((row) => (
              <li
                className="rounded-3xl border-2 border-border bg-surface p-5"
                key={row.id}
              >
                <h2 className="text-lead font-bold">
                  <SiteLink
                    className="text-link underline"
                    href={recurringDonationPath(row.id)}
                  >
                    {t("open", { amount: formatPaise(row.amountMinor) })}
                  </SiteLink>
                </h2>
                <p>
                  {row.cancelRequestedAt &&
                  row.status !== "cancelled" &&
                  row.status !== "completed"
                    ? t("pendingCancel")
                    : t(`statuses.${row.status}`)}
                </p>
                <p>
                  {t("next")}:{" "}
                  {row.nextChargeAt
                    ? format.dateTime(row.nextChargeAt, "long")
                    : t("none")}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p>{t("empty")}</p>
        )}
        {terms.open && terms.recurringEnabled ? (
          <StartForm
            has80G={terms.has80G}
            labels={{
              title: t("start"),
              amount: t("amount"),
              amountHelp: t("amountHelp"),
              pan: t("pan"),
              panHelp: t("panHelp"),
              adult: t("adult"),
              indian: t("indian"),
              wall: t("wall"),
              submit: t("continue"),
              submitting: t("submitting"),
            }}
          />
        ) : (
          <p>{t("closed")}</p>
        )}
        <SiteLink className="text-link underline" href={APP_ROUTES.dashboard}>
          {t("back")}
        </SiteLink>
      </div>
    </Section>
  );
}
