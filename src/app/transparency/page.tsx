import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { connection } from "next/server";
import { Suspense } from "react";

import { PUBLIC_READER } from "@/app/competitions/_lib/public-reader";
import { PageHeader } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { SiteLink } from "@/components/site/site-link";
import { TableScroller } from "@/components/site/table-scroller";
import { TRANSPARENCY_PATH, transparencyYearPath } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { pageMetadata } from "@/lib/seo";
import { as } from "@/server/app";
import { periodStart } from "@/server/modules/ledger/domain/period";
import { formatPaise } from "@/server/modules/payments/domain/money-format";
import type { Category } from "@/server/modules/transparency/read";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("transparency.meta");
  return pageMetadata({
    title: t("title"),
    description: t("description"),
    path: TRANSPARENCY_PATH,
  });
}

export default async function Page({
  searchParams,
}: PageProps<"/transparency">) {
  const t = await getTranslations("transparency");
  return (
    <>
      <Section hue="teal" tone="tint" className="pt-10 sm:pt-14">
        <PageHeader
          eyebrow={t("eyebrow")}
          tile="teal"
          title={t("title")}
          lead={t("lead")}
        />
        <p className="mt-5 max-w-prose text-ink-muted">{t("method")}</p>
      </Section>
      <Section hue="teal">
        <Suspense fallback={<p className="text-ink-muted">{t("loading")}</p>}>
          <PublishedAccounts searchParams={searchParams} />
        </Suspense>
        <div className="mt-10 flex flex-wrap gap-x-6 gap-y-3">
          <SiteLink
            className="font-semibold text-link underline"
            href={ROUTES.impact.path}
          >
            {t("impactLink")}
          </SiteLink>
          <SiteLink
            className="font-semibold text-link underline"
            href={ROUTES.donate.path}
          >
            {t("giveLink")}
          </SiteLink>
        </div>
      </Section>
    </>
  );
}

async function PublishedAccounts({
  searchParams,
}: {
  searchParams: PageProps<"/transparency">["searchParams"];
}) {
  await connection();
  const search = await searchParams;
  const fy = typeof search.fy === "string" ? search.fy : undefined;
  const [t, format, view] = await Promise.all([
    getTranslations("transparency"),
    getFormatter(),
    as(PUBLIC_READER).getTransparency(fy ? { fy } : {}),
  ]);
  if (!view.published) return <p className="max-w-prose">{t("empty")}</p>;
  const monthLabel = (month: string) =>
    format.dateTime(periodStart(month), {
      timeZone: "Asia/Kolkata",
      month: "long",
      year: "numeric",
    });

  return (
    <>
      <nav aria-label={t("yearNav")} className="mb-6 flex flex-wrap gap-3">
        {view.years.map((year) => (
          <SiteLink
            key={year}
            href={transparencyYearPath(year)}
            aria-current={year === view.fy ? "page" : undefined}
            className="inline-flex min-h-11 items-center rounded-full border border-border px-4 py-2 font-semibold text-link underline aria-[current=page]:bg-surface-muted aria-[current=page]:text-ink"
          >
            {year}
          </SiteLink>
        ))}
      </nav>
      <h2 className="text-h2">{t("year", { fy: view.fy })}</h2>
      <p className="mt-3 max-w-prose text-ink-muted">
        {t("through", { month: monthLabel(view.months.at(-1)!.month) })}
      </p>
      <dl className="mt-6 grid gap-4 sm:grid-cols-3">
        <div className="rounded-3xl border border-border bg-surface p-5">
          <dt>{t("income")}</dt>
          <dd className="mt-2 font-display text-h2 font-bold wrap-anywhere">
            {formatPaise(view.incomeMinor)}
          </dd>
        </div>
        <div className="rounded-3xl border border-border bg-surface p-5">
          <dt>{t("spending")}</dt>
          <dd className="mt-2 font-display text-h2 font-bold wrap-anywhere">
            {formatPaise(view.spendingMinor)}
          </dd>
        </div>
        <div className="rounded-3xl border border-border bg-surface p-5">
          <dt>{t("donations")}</dt>
          <dd
            data-testid="transparency-donations"
            className="mt-2 font-display text-h2 font-bold wrap-anywhere"
          >
            {formatPaise(view.donationsMinor)}
          </dd>
        </div>
      </dl>
      <h3 className="mt-12 text-h3">{t("monthly")}</h3>
      <div className="mt-6 space-y-10">
        {view.months
          .slice()
          .reverse()
          .map((month) => (
            <section key={month.month} aria-labelledby={`month-${month.month}`}>
              <h4
                id={`month-${month.month}`}
                className="font-display text-xl font-bold"
              >
                {monthLabel(month.month)}
              </h4>
              <div className="mt-4 grid gap-5 lg:grid-cols-2">
                <CategoryTable
                  id={`income-${month.month}`}
                  caption={t("monthIncome", { month: monthLabel(month.month) })}
                  categories={month.income}
                  total={month.incomeMinor}
                />
                <CategoryTable
                  id={`spending-${month.month}`}
                  caption={t("monthSpending", {
                    month: monthLabel(month.month),
                  })}
                  categories={month.spending}
                  total={month.spendingMinor}
                />
              </div>
              <p className="mt-3 text-ink-muted">
                {t("donations")}:{" "}
                <span className="font-semibold text-ink">
                  {formatPaise(month.donationsMinor)}
                </span>
              </p>
            </section>
          ))}
      </div>
      <section className="mt-12" aria-labelledby="organisations-title">
        <h3 className="text-h3" id="organisations-title">
          {t("organisations.title")}
        </h3>
        <p className="mt-3 max-w-prose text-ink-muted">
          {t("organisations.lead")}
        </p>
        {view.organisations.length ? (
          <TableScroller captionId="organisations-caption" className="mt-4">
            <table className="w-full text-left">
              <caption id="organisations-caption" className="sr-only">
                {t("organisations.caption")}
              </caption>
              <thead className="bg-surface-muted">
                <tr>
                  <th scope="col" className="px-4 py-3">
                    {t("organisations.name")}
                  </th>
                  <th scope="col" className="px-4 py-3 text-right">
                    {t("amount")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {view.organisations.map(({ name, totalMinor }) => (
                  <tr key={name} className="border-t border-border">
                    <th
                      scope="row"
                      className="px-4 py-3 text-left font-medium wrap-anywhere"
                    >
                      {name}
                    </th>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {formatPaise(totalMinor)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroller>
        ) : (
          <p className="mt-4">{t("organisations.empty")}</p>
        )}
      </section>
      <section className="mt-12" aria-labelledby="wall-title">
        <h3 className="text-h3" id="wall-title">
          {t("wall.title")}
        </h3>
        <p className="mt-3 max-w-prose text-ink-muted">{t("wall.lead")}</p>
        {view.supporters.length ? (
          <ul className="mt-4 list-inside list-disc space-y-3 sm:columns-2 lg:columns-3">
            {view.supporters.map((name) => (
              <li
                key={name}
                className="break-inside-avoid rounded-xl border border-border bg-surface px-4 py-3 wrap-anywhere"
              >
                {name}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-4">{t("wall.empty")}</p>
        )}
      </section>
    </>
  );
}

async function CategoryTable({
  id,
  caption,
  categories,
  total,
}: {
  id: string;
  caption: string;
  categories: Category[];
  total: bigint;
}) {
  const t = await getTranslations("transparency");
  return (
    <TableScroller captionId={id}>
      <table className="w-full text-left">
        <caption id={id} className="px-4 py-3 text-left font-semibold">
          {caption}
        </caption>
        <thead className="bg-surface-muted">
          <tr>
            <th scope="col" className="px-4 py-3">
              {t("category")}
            </th>
            <th scope="col" className="px-4 py-3 text-right">
              {t("amount")}
            </th>
          </tr>
        </thead>
        <tbody>
          {categories.map((category) => (
            <tr
              key={JSON.stringify([category.group, category.label])}
              className="border-t border-border"
            >
              <th scope="row" className="px-4 py-3 font-medium wrap-anywhere">
                {category.label ?? t(`groups.${category.group}`)}
              </th>
              <td className="px-4 py-3 text-right tabular-nums">
                {formatPaise(category.amountMinor)}
              </td>
            </tr>
          ))}
          {!categories.length ? (
            <tr>
              <td colSpan={2} className="px-4 py-3 text-ink-muted">
                {t("noActivity")}
              </td>
            </tr>
          ) : null}
        </tbody>
        <tfoot>
          <tr className="border-t border-border bg-surface-muted">
            <th scope="row" className="px-4 py-3">
              {t("total")}
            </th>
            <td className="px-4 py-3 text-right font-bold tabular-nums">
              {formatPaise(total)}
            </td>
          </tr>
        </tfoot>
      </table>
    </TableScroller>
  );
}
