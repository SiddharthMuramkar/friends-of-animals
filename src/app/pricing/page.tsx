import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";

import { Placeholder } from "@/components/site/placeholder";
import { Section } from "@/components/site/section";
import { TableScroller } from "@/components/site/table-scroller";
import { ROUTES } from "@/lib/routes";
import { pageMetadata } from "@/lib/seo";
import { SITE } from "@/lib/site";

import { PolicyBlock, PolicyTop } from "./_components/policy";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("pricing.meta");
  return pageMetadata({
    title: t("title"),
    description: t("description"),
    path: ROUTES.pricing.path,
  });
}

const SHORT = [
  "perCompetition",
  "school",
  "self",
  "noExtras",
  "donations",
] as const;
const DETAIL = ["set", "pay", "receipt", "gst", "switch"] as const;
const LINK =
  "inline-flex min-h-11 items-center font-semibold text-link underline decoration-2 underline-offset-4 hover:text-link-hover";

export default async function Page() {
  const t = await getTranslations("pricing");
  const { fees } = SITE.org;
  return (
    <>
      <PolicyTop
        eyebrow={t("eyebrow")}
        title={t("title")}
        updated={t("updated")}
        shortTitle={t("short.title")}
        items={SHORT.map((k) => t(`short.items.${k}`))}
      />
      <Section innerClassName="[&>*]:max-w-3xl">
        <PolicyBlock id="fees" title={t("fees.title")}>
          <p className="text-ink-muted">{t("fees.lead")}</p>
          <TableScroller captionId="fees-caption">
            <table className="w-full text-left">
              <caption id="fees-caption" className="sr-only">
                {t("fees.caption")}
              </caption>
              <thead className="bg-surface-muted text-sm">
                <tr>
                  <th scope="col" className="px-5 py-3">
                    {t("fees.route")}
                  </th>
                  <th scope="col" className="px-5 py-3">
                    {t("fees.who")}
                  </th>
                  <th scope="col" className="px-5 py-3">
                    {t("fees.amount")}
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-t border-border align-top">
                  <th scope="row" className="px-5 py-4">
                    {t("fees.school")}
                  </th>
                  <td className="px-5 py-4 text-ink-muted">
                    {t("fees.schoolWho")}
                  </td>
                  <td className="px-5 py-4">
                    <Placeholder fact={fees.school} />
                  </td>
                </tr>
                <tr className="border-t border-border align-top">
                  <th scope="row" className="px-5 py-4">
                    {t("fees.self")}
                  </th>
                  <td className="px-5 py-4 text-ink-muted">
                    {t("fees.selfWho")}
                  </td>
                  <td className="px-5 py-4">
                    <Placeholder fact={fees.individual} />
                  </td>
                </tr>
              </tbody>
            </table>
          </TableScroller>
        </PolicyBlock>
        <h2 className="mt-14 text-h2">{t("detail.title")}</h2>
        <div className="mt-8 grid gap-10">
          {DETAIL.map((k) => (
            <PolicyBlock key={k} id={k} title={t(`detail.${k}.title`)}>
              <p>{t(`detail.${k}.body`)}</p>
            </PolicyBlock>
          ))}
        </div>
        <ul className="mt-12 grid gap-1 border-t-2 border-border pt-6">
          <li>
            <Link href={ROUTES.refunds.path} className={LINK}>
              {t("refundsLink")}
            </Link>
          </li>
          <li>
            <Link href={ROUTES.contact.path} className={LINK}>
              {t("questions")}
            </Link>
          </li>
        </ul>
      </Section>
    </>
  );
}
