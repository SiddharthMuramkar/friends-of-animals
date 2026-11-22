import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { ButtonLink } from "@/components/site/button-link";
import { Chip } from "@/components/site/chip";
import { PageHeader } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { ROUTES } from "@/lib/routes";
import { pageMetadata } from "@/lib/seo";
import { cn } from "@/lib/utils";

import { individualLink, type IndividualLink } from "./_lib/individual-link";

const HUE = ROUTES.participate.hue;

const CARD =
  "flex h-full flex-col rounded-3xl border-2 bg-surface p-6 shadow-warm";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("participant.participate.meta");
  return pageMetadata({
    title: t("title"),
    description: t("description"),
    path: ROUTES.participate.path,
  });
}

type Labels = Record<IndividualLink["kind"], string>;

export default async function Page({
  searchParams,
}: PageProps<"/participate">) {
  const [t, note] = await Promise.all([
    getTranslations("participant.participate"),
    getTranslations("participant.schoolNote"),
  ]);
  const labels: Labels = {
    register: t("individual.register"),
    choose: t("individual.choose"),
  };

  return (
    <Section hue={HUE} tone="tint" className="pt-10 sm:pt-14">
      <PageHeader
        eyebrow={t("eyebrow")}
        tile={HUE}
        title={t("title")}
        lead={t("lead")}
      />
      {/* The school route comes first, recommended, with the reason. */}
      <ul className="mt-10 grid gap-6 md:grid-cols-2">
        <li>
          <article
            aria-labelledby="route-school"
            className={cn(CARD, "border-green-700 dark:border-green-400")}
          >
            <div className="flex flex-wrap items-center gap-3">
              <h2 id="route-school" className="text-h4 leading-tight">
                {t("school.title")}
              </h2>
              <Chip tone="green">{t("recommended")}</Chip>
            </div>
            <p className="mt-3 font-semibold text-ink">{note("title")}</p>
            <p className="mt-2 text-ink-muted">{note("body")}</p>
            <p className="mt-2 text-ink-muted">{note("ask")}</p>
            <div className="mt-auto pt-6">
              <ButtonLink href={ROUTES.schools.path}>{note("link")}</ButtonLink>
            </div>
          </article>
        </li>
        <li>
          <article
            aria-labelledby="route-individual"
            className={cn(CARD, "border-border-strong")}
          >
            <h2 id="route-individual" className="text-h4 leading-tight">
              {t("individual.title")}
            </h2>
            <p className="mt-3 text-ink">{t("individual.body")}</p>
            <p className="mt-2 text-ink-muted">{t("individual.under18")}</p>
            {/* The competition comes from the query string, read per
                request, so it streams in while the rest is prerendered. */}
            <Suspense
              fallback={
                <IndividualButton
                  link={individualLink(undefined)}
                  labels={labels}
                />
              }
            >
              <IndividualCompetitionButton
                searchParams={searchParams}
                labels={labels}
              />
            </Suspense>
          </article>
        </li>
      </ul>
    </Section>
  );
}

async function IndividualCompetitionButton({
  searchParams,
  labels,
}: {
  searchParams: PageProps<"/participate">["searchParams"];
  labels: Labels;
}) {
  const { competition } = await searchParams;
  return (
    <IndividualButton link={individualLink(competition)} labels={labels} />
  );
}

function IndividualButton({
  link,
  labels,
}: {
  link: IndividualLink;
  labels: Labels;
}) {
  return (
    <div className="mt-auto pt-6">
      <ButtonLink href={link.href} variant="secondary">
        {labels[link.kind]}
      </ButtonLink>
    </div>
  );
}
