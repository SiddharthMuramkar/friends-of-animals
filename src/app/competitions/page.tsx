import { ArrowDown } from "lucide-react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { connection } from "next/server";
import { Suspense } from "react";

import { SiteLink } from "@/components/site/site-link";

import { QuoteFigure } from "@/components/showcase/quote-figure";
import { CompetitionCard } from "@/components/showcase/competition-card";
import { HappyMosaic } from "@/components/showcase/happy-mosaic";
import { TwoDoors } from "@/components/showcase/two-doors";
import { ButtonLink } from "@/components/site/button-link";
import { Disclosure } from "@/components/site/disclosure";
import { ExplainState } from "@/components/site/explain-state";
import { PageHeader, SectionHeading } from "@/components/site/heading";
import { Photo } from "@/components/site/photo";
import { Section } from "@/components/site/section";
import { TileMarker } from "@/components/site/tile";
import type { SiteImageId } from "@/lib/images";
import { ROUTES } from "@/lib/routes";
import { pageMetadata } from "@/lib/seo";

import { EasyRead } from "@/components/site/easy-read";
import { cardClass, CompetitionFilters } from "./_components/filters";
import { publishedCompetitions } from "./_lib/public-reads";
import { filterTokens } from "./_lib/view";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("competitions.meta");
  return pageMetadata({
    title: t("title"),
    description: t("description"),
    path: ROUTES.competitions.path,
  });
}

const HUE = ROUTES.competitions.hue;

// Four poses that are fun to draw: two dogs, two cats.
const PROMPTS = [
  ["dog-bhubaneswar-belly-up", "rolling"],
  ["kitten-tree-dingore", "tree"],
  ["dog-anjuna-beach-happy", "grin"],
  ["cat-grass-srinagar", "stretch"],
] as const satisfies readonly (readonly [SiteImageId, string])[];

/**
 * The published competitions, from the database at request time: the
 * rest of the page is prerendered and this streams into it. Drafts never
 * reach the read model.
 */
async function OpenCompetitions() {
  await connection();
  const t = await getTranslations("competitions");
  const list = await publishedCompetitions();

  if (list.length === 0)
    return (
      <ExplainState
        title={t("empty.title")}
        back={{ href: ROUTES.contact.path, label: t("empty.back") }}
        className="mt-8 max-w-2xl"
      >
        <p>{t("empty.body")}</p>
      </ExplainState>
    );

  return (
    <>
      <p className="mt-4 max-w-prose text-lead text-ink-muted">
        {t("list.lead")}
      </p>
      <CompetitionFilters className="mt-8">
        <ul className="mt-6 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((c) => {
            const tokens = filterTokens(c);
            return (
              <li
                key={c.slug}
                className={`${cardClass} flex`}
                data-status={tokens.status}
                data-disciplines={tokens.disciplines}
                data-ages={tokens.ages}
              >
                <CompetitionCard competition={c} className="w-full" />
              </li>
            );
          })}
          <li className="flex">
            <div className="flex w-full flex-col justify-between gap-6 rounded-3xl border-2 border-dashed border-border-strong p-6">
              <div>
                <div aria-hidden="true" className="flex gap-1.5">
                  <TileMarker hue="pink" />
                  <TileMarker hue="yellow" />
                  <TileMarker hue="teal" />
                </div>
                <h3 className="mt-4 text-h4 leading-tight">
                  {t("endCard.title")}
                </h3>
                <p className="mt-3 text-ink-muted">{t("endCard.body")}</p>
              </div>
              <SiteLink
                href={ROUTES.contact.path}
                className="inline-flex min-h-11 items-center self-start font-semibold text-link underline decoration-2 underline-offset-4 hover:text-link-hover"
              >
                {t("endCard.link")}
              </SiteLink>
            </div>
          </li>
        </ul>
      </CompetitionFilters>
    </>
  );
}

/** Card-sized blocks while the list streams in, so the page doesn't jump. */
async function OpenCompetitionsFallback() {
  const t = await getTranslations("competitions.list");
  return (
    <output className="mt-8 block">
      <span className="sr-only">{t("loading")}</span>
      <span
        aria-hidden="true"
        className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3"
      >
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="block h-96 rounded-3xl border-2 border-border bg-surface-muted motion-safe:animate-pulse"
          />
        ))}
      </span>
    </output>
  );
}

export default async function Page() {
  const t = await getTranslations("competitions");

  return (
    <>
      <Section hue={HUE} tone="tint" className="pt-10 sm:pt-14">
        <div className="grid grid-cols-[minmax(0,1fr)] items-center gap-10 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:gap-14">
          <div>
            <PageHeader
              eyebrow={t("hero.eyebrow")}
              tile="pink"
              title={t("hero.title")}
              lead={t("hero.lead")}
            />
            <EasyRead label={t("easyRead")} className="mt-8 max-w-xl">
              <p>{t("hero.easy")}</p>
            </EasyRead>
            <ButtonLink href="#open" size="lg" className="mt-8">
              {t("list.title")}
              <ArrowDown aria-hidden="true" />
            </ButtonLink>
          </div>
          <Photo
            id="art-supplies-flatlay-blue"
            sizes="(min-width: 1024px) min(40vw, 512px), min(92vw, 512px)"
            preload
            frame="red"
            frameCorner="bottom-right"
            caption={t("hero.photoCaption")}
            className="aspect-4/3 lg:aspect-4/5"
            figureClassName="mx-auto w-full max-w-lg"
          />
        </div>
        <QuoteFigure id="Q25" hue="pink" size="md" className="mt-14 sm:mt-20" />
      </Section>

      {/* Drawing prompts: not sample content, so it shows in production. */}
      <Section labelledBy="draw-title" hue={HUE} width="wide">
        <SectionHeading
          id="draw-title"
          eyebrow={t("draw.eyebrow")}
          tile="yellow"
          title={t("draw.title")}
          lead={t("draw.lead")}
        />
        <HappyMosaic
          layout="row4"
          label={t("draw.label")}
          tiles={PROMPTS.map(([id, key]) => ({
            id,
            caption: t(`draw.prompts.${key}`),
          }))}
          className="mt-12"
        />
      </Section>

      <Section
        id="open"
        labelledBy="open-title"
        hue={HUE}
        className="scroll-mt-24"
      >
        <SectionHeading id="open-title" title={t("list.title")} />
        <Suspense fallback={<OpenCompetitionsFallback />}>
          <OpenCompetitions />
        </Suspense>
      </Section>

      <Section labelledBy="own-title" hue={HUE} tone="tint">
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-2 lg:gap-14">
          <div>
            <SectionHeading
              id="own-title"
              title={t("own.title")}
              lead={t("own.lead")}
            />
            <p className="mt-4 max-w-prose text-ink">{t("own.body")}</p>
            <Disclosure summary={t("own.adultSummary")} className="mt-6">
              <p>{t("own.adult")}</p>
            </Disclosure>
          </div>
          <QuoteFigure
            id="Q39"
            hue="yellow"
            size="md"
            className="self-center"
          />
        </div>
      </Section>

      <Section hue={HUE}>
        <TwoDoors id="doors-competitions" />
      </Section>
    </>
  );
}
