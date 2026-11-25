import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";

import { FormAlert } from "@/components/form/form-alert";
import { SelectField } from "@/components/form/select-field";
import { TextField } from "@/components/form/text-field";
import { ButtonLink, buttonStyles } from "@/components/site/button-link";
import { SiteLink } from "@/components/site/site-link";
import { TableScroller } from "@/components/site/table-scroller";
import { ADMIN_DONATIONS, adminDonationPath } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { cn } from "@/lib/utils";
import { as, currentActor } from "@/server/app";
import type { DonationListItem } from "@/server/modules/donations";
import { DONATION_STATUSES } from "@/server/modules/donations/domain/donation-status";
import { DONOR_TYPES } from "@/server/modules/donations/domain/donor";
import { formatPaise } from "@/server/modules/payments/domain/money-format";

import { adminCall } from "../_lib/boundary";
import { DonationsDenied, DonationsFrame } from "./_components/frame";

// Finance's donations (#106): every online donation, newest first, with
// filters by status, donor type and IST dates. Finance only: donors'
// names are personal data, and super admin is no wildcard.

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminDonations.meta");
  return {
    title: t("title"),
    description: t("description"),
    robots: { index: false, follow: false },
  };
}

const cell = "px-4 py-3 align-top";
const nowrap = cn(cell, "whitespace-nowrap");

export default async function Page({
  searchParams,
}: PageProps<"/admin/donations">) {
  const [actor, t, callout] = await Promise.all([
    currentActor(),
    getTranslations("adminDonations"),
    getTranslations("common.callout"),
  ]);
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const params = await searchParams;
  const one = (key: string) =>
    typeof params[key] === "string" ? params[key] : undefined;
  const filters = {
    status: one("status"),
    donorType: one("donorType"),
    from: one("from"),
    to: one("to"),
  };
  const view = await adminCall(
    () => as(actor).listDonations(filters),
    ADMIN_DONATIONS
  );
  if (!view.ok) return <DonationsDenied />;
  const result = view.value;
  const filtered = Object.values(filters).some(Boolean);

  return (
    <DonationsFrame title={t("title")} lead={t("lead")}>
      <search>
        <form action={ADMIN_DONATIONS} method="get" className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <SelectField
              id="donations-status"
              name="status"
              label={t("filters.status")}
              placeholder={t("filters.anyStatus")}
              options={DONATION_STATUSES.map((status) => ({
                value: status,
                label: t(`statuses.${status}`),
              }))}
              defaultValue={filters.status ?? ""}
            />
            <SelectField
              id="donations-donor-type"
              name="donorType"
              label={t("filters.donorType")}
              placeholder={t("filters.anyDonor")}
              options={DONOR_TYPES.map((type) => ({
                value: type,
                label: t(`donorTypes.${type}`),
              }))}
              defaultValue={filters.donorType ?? ""}
            />
            <TextField
              id="donations-from"
              name="from"
              type="date"
              label={t("filters.from")}
              defaultValue={filters.from}
            />
            <TextField
              id="donations-to"
              name="to"
              type="date"
              label={t("filters.to")}
              defaultValue={filters.to}
            />
          </div>
          <div className="flex flex-wrap gap-3">
            <button
              type="submit"
              className={buttonStyles({ variant: "secondary" })}
            >
              {t("filters.apply")}
            </button>
            {filtered ? (
              <ButtonLink href={ADMIN_DONATIONS} variant="quiet">
                {t("filters.reset")}
              </ButtonLink>
            ) : null}
          </div>
        </form>
      </search>
      {result.ok ? (
        <>
          <DonationTable donations={result.donations} />
          {result.limited ? (
            <p className="text-ink-muted">
              {t("limited", { count: result.donations.length })}
            </p>
          ) : null}
        </>
      ) : (
        <FormAlert tone="danger" label={callout("danger")}>
          <p>{t(`errors.${result.error}`)}</p>
        </FormAlert>
      )}
    </DonationsFrame>
  );
}

async function DonationTable({ donations }: { donations: DonationListItem[] }) {
  const [t, format] = await Promise.all([
    getTranslations("adminDonations"),
    getFormatter(),
  ]);
  if (donations.length === 0) {
    return <p className="text-ink-muted">{t("empty")}</p>;
  }
  return (
    <TableScroller
      captionId="donations-caption"
      className="max-h-[70vh] overflow-auto"
    >
      <table className="w-full text-left">
        <caption id="donations-caption" className="sr-only">
          {t("table.caption")}
        </caption>
        <thead className="sticky top-0 z-10 bg-surface-muted text-sm">
          <tr>
            <th scope="col" className={nowrap}>
              {t("table.amount")}
            </th>
            <th scope="col" className={nowrap}>
              {t("table.donor")}
            </th>
            <th scope="col" className={nowrap}>
              {t("table.status")}
            </th>
            <th scope="col" className={nowrap}>
              {t("table.receipt")}
            </th>
            <th scope="col" className={nowrap}>
              {t("table.date")}
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {donations.map((each) => {
            const amount = formatPaise(each.amountMinor);
            const donor = each.organisationName
              ? `${each.organisationName} (${each.donorName})`
              : each.donorName;
            const kind = [
              t(`donorTypes.${each.donorType}`),
              ...(each.guest ? [t("table.guest")] : []),
            ].join(" · ");
            return (
              <tr key={each.id}>
                <th scope="row" className={cn(nowrap, "bg-surface")}>
                  <SiteLink
                    href={adminDonationPath(each.id)}
                    aria-label={t("table.open", { amount, donor })}
                    className="inline-flex min-h-11 items-center text-link underline"
                  >
                    {amount}
                  </SiteLink>
                </th>
                <td className={cn(cell, "wrap-anywhere")}>
                  {donor}
                  <span className="block text-sm text-ink-muted">{kind}</span>
                </td>
                <td className={cell}>{t(`statuses.${each.status}`)}</td>
                <td className={nowrap}>
                  {each.receiptNumber ?? t("table.none")}
                </td>
                <td className={nowrap}>
                  <time dateTime={each.createdAt.toISOString()}>
                    {format.dateTime(each.createdAt, {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </time>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </TableScroller>
  );
}
