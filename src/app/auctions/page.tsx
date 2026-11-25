import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { connection } from "next/server";
import { Suspense } from "react";
import { PageHeader } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { ButtonLink } from "@/components/site/button-link";
import { pageMetadata } from "@/lib/seo";
import { auctionLotPath } from "@/lib/app-routes";
import { as } from "@/server/app";
import { PUBLIC_READER } from "../competitions/_lib/public-reader";
import { LotDetails } from "./_lot-details";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auctions");
  return pageMetadata({
    title: t("title"),
    description: t("lead"),
    path: "/auctions",
  });
}

export default async function Page({ searchParams }: PageProps<"/auctions">) {
  const t = await getTranslations("auctions");
  return (
    <Section hue="yellow" tone="tint" className="pt-10 sm:pt-14">
      <PageHeader title={t("title")} lead={t("lead")} />
      <Suspense
        fallback={<p className="mt-8 text-ink-muted">{t("loading")}</p>}
      >
        <Lots searchParams={searchParams} />
      </Suspense>
    </Section>
  );
}
async function Lots({
  searchParams,
}: Pick<PageProps<"/auctions">, "searchParams">) {
  // Fresh reads: consent withdrawal must hide a lot immediately, even
  // before the outbox worker cancels it and releases its artwork.
  await connection();
  const [lots, t, query] = await Promise.all([
    as(PUBLIC_READER).browseLots(),
    getTranslations("auctions"),
    searchParams,
  ]);
  return (
    <section className="mt-8" aria-labelledby="auction-lots-heading">
      <h2 id="auction-lots-heading" className="text-h3 text-ink">
        {t("upcoming")}
      </h2>
      {query.bid === "unavailable" ? (
        <p role="alert" className="mt-4 text-ink">
          {t("bidding.unavailable")}
        </p>
      ) : null}
      {lots.length === 0 ? (
        <p className="mt-4 text-ink">{t("empty")}</p>
      ) : (
        <ul className="mt-6 grid grid-cols-[minmax(0,1fr)] gap-6 sm:grid-cols-2">
          {lots.map((lot, index) => (
            <li
              key={lot.lotCode}
              className="min-w-0 rounded-3xl border-2 border-border bg-surface p-5 shadow-warm sm:p-6"
            >
              <h3 className="text-h4 text-ink">
                {t("lot", { code: lot.lotCode })}
              </h3>
              <LotDetails lot={lot} priority={index === 0} />
              <ButtonLink className="mt-5" href={auctionLotPath(lot.lotCode)}>
                {t("view", { code: lot.lotCode })}
              </ButtonLink>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
