import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { connection } from "next/server";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { Section } from "@/components/site/section";
import { PageHeader } from "@/components/site/heading";
import { ButtonLink } from "@/components/site/button-link";
import { as, currentActor } from "@/server/app";
import { PUBLIC_READER } from "../../competitions/_lib/public-reader";
import { BidForm } from "../_bid-form";
import { LiveLotRefresh } from "../_live-refresh";
import { LotDetails } from "../_lot-details";

// A minor's lot detail must not be indexed: its consent can change at any time.
export function generateStaticParams() {
  return [{ lotCode: "__placeholder__" }];
}
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auctions");
  return { title: t("title"), robots: { index: false, follow: false } };
}
async function Lot({ params, searchParams }: PageProps<"/auctions/[lotCode]">) {
  await connection();
  const { lotCode } = await params;
  const [t, lot, actor, query] = await Promise.all([
    getTranslations("auctions"),
    as(PUBLIC_READER).getLot({ lotCode }),
    currentActor(),
    searchParams,
  ]);
  if (!lot) notFound();
  return (
    <>
      <article className="mt-8 max-w-2xl rounded-3xl border-2 border-border bg-surface p-5 shadow-warm sm:p-6">
        <h2 className="text-h3 text-ink">{t("lot", { code: lot.lotCode })}</h2>
        <LotDetails lot={lot} />
        <BidForm
          lot={lot}
          signedIn={actor.kind === "user"}
          result={query.bid}
        />
        <p className="mt-4 text-sm text-ink-muted">{t("refresh")}</p>
        <LiveLotRefresh />
      </article>
    </>
  );
}

export default async function Page(props: PageProps<"/auctions/[lotCode]">) {
  const t = await getTranslations("auctions");
  return (
    <Section hue="yellow" tone="tint" className="min-h-svh pt-10 sm:pt-14">
      <ButtonLink href="/auctions" variant="quiet">
        {t("back")}
      </ButtonLink>
      <PageHeader
        className="mt-5"
        title={t("detailTitle")}
        lead={t("detailLead")}
      />
      <Suspense
        fallback={
          <output className="mt-8 block">
            <span className="sr-only">{t("loading")}</span>
            <span aria-hidden="true" className="block">
              <span className="block min-h-116 max-w-2xl rounded-3xl border-2 border-border bg-surface p-5">
                <span className="block h-8 w-52 max-w-full rounded-xl bg-surface-muted" />
                <span className="block h-5 w-20 rounded-lg bg-surface-muted" />
                <span className="mt-4 block h-6 w-40 rounded-lg bg-surface-muted" />
                <span className="mt-5 block h-14 w-full rounded-xl bg-surface-muted" />
                <span className="mt-5 block h-8 w-24 rounded-lg bg-surface-muted" />
                <span className="mt-4 block h-8 w-48 rounded-lg bg-surface-muted" />
                <span className="mt-4 block h-8 w-48 rounded-lg bg-surface-muted" />
              </span>
            </span>
          </output>
        }
      >
        <Lot {...props} />
      </Suspense>
    </Section>
  );
}
