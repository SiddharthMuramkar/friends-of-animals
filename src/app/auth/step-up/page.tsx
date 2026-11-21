import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { PageHeader } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { SECOND_FACTOR_SETTINGS } from "@/server/second-factor/settings";

import { VerifyPanel } from "../_components/verify-panel";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("security.stepUp.meta");
  return {
    title: t("title"),
    description: t("description"),
    robots: { index: false, follow: false },
  };
}

type SearchParams = Promise<{ next?: string | string[] }>;

/** A fresh second factor before a sensitive change (granting a role…). */
export default async function Page({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const t = await getTranslations("security.stepUp");
  const minutes = SECOND_FACTOR_SETTINGS.stepUpWindowMs / 60_000;
  return (
    <Section hue="blue" tone="tint" width="prose" className="pt-10 sm:pt-14">
      <PageHeader
        eyebrow={t("eyebrow")}
        tile="blue"
        title={t("title")}
        lead={t("lead", { minutes })}
      />
      <Suspense
        fallback={<p className="mt-8 text-ink-muted">{t("loading")}</p>}
      >
        <Panel searchParams={searchParams} />
      </Suspense>
    </Section>
  );
}

async function Panel({ searchParams }: { searchParams: SearchParams }) {
  const { next } = await searchParams;
  return <VerifyPanel next={next} />;
}
