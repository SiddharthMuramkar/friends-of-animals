import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { KolamDivider } from "@/components/art/kolam-divider";
import { LivingIllustration } from "@/components/art/living-illustration";
import { type Sticker, StickerScatter } from "@/components/art/sticker-scatter";
import { HappyMosaic } from "@/components/showcase/happy-mosaic";
import { QuoteFigure } from "@/components/showcase/quote-figure";
import { SeasonalCard } from "@/components/showcase/seasonal-card";
import { Callout } from "@/components/site/callout";
import { Disclosure } from "@/components/site/disclosure";
import { PageHeader, SectionHeading } from "@/components/site/heading";
import { InPageLink } from "@/components/site/in-page-link";
import { Photo } from "@/components/site/photo";
import { Section } from "@/components/site/section";
import { TileDivider } from "@/components/site/tile";
import { NEIGHBOURS } from "@/content/awareness/neighbours";
import {
  BITE_FIRST_AID,
  HURT_ANIMAL_GROWN_UP,
  HURT_ANIMAL_KID_STEPS,
  PCA_ACT_URL,
  RESCUE_SOURCES,
} from "@/content/awareness/rescue";
import type { SiteImageId } from "@/lib/images";
import { ROUTES } from "@/lib/routes";
import { pageMetadata } from "@/lib/seo";

import { NeighbourCard } from "./_components/neighbour-card";
import { PledgeCard, type PledgeLabels } from "./_components/pledge-card";
import { StreetScene } from "./_components/street-scene";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("awareness.meta");
  return pageMetadata({
    title: t("title"),
    description: t("description"),
    path: ROUTES.awareness.path,
  });
}

const JUMPS = [
  ["month", "jumpMonth"],
  ["neighbours", "jumpNeighbours"],
  ["hurt", "jumpHurt"],
  ["law", "jumpLaw"],
  ["pledge", "jumpPledge"],
] as const;

// A cheerful puppy and kitten beside the pledge.
const PLEDGE_PHOTOS = [
  ["puppy-white-running", "puppy"],
  ["kitten-tree-peekaboo", "kitten"],
] as const satisfies readonly (readonly [SiteImageId, string])[];

const SWAPS = ["milk", "bread", "sweets", "chick", "holi", "manja"] as const;

// Doodles in the empty space beside two section headings. Only on wide
// screens: below lg the heading fills the row (month), and below xl the prose
// column leaves no margin (law).
const MONTH_STICKERS: readonly Sticker[] = [
  {
    id: "sticker-diya",
    className: "hidden lg:block top-0 right-[5%] w-16",
    tilt: -4,
  },
  {
    id: "sticker-sparrow-bowl",
    className: "hidden xl:block top-3 right-[21%] w-10",
    tilt: 8,
  },
];
const LAW_STICKERS: readonly Sticker[] = [
  {
    id: "sticker-puppy",
    className: "hidden xl:block top-6 -left-32 w-14",
    tilt: -6,
  },
  {
    id: "sticker-marigold",
    className: "hidden xl:block top-52 -right-36 w-20",
    tilt: 12,
  },
];

const PROMISES = [
  "water",
  "distance",
  "grownUp",
  "thread",
  "bin",
  "nests",
] as const;

const STEP_TILES = [
  "bg-red-600 text-white",
  "bg-yellow-300 text-neutral-900",
  "bg-teal-400 text-neutral-900",
  "bg-blue-700 text-white",
  "bg-pink-400 text-neutral-900",
  "bg-green-500 text-neutral-900",
];

const LINK =
  "inline-flex min-h-6 items-center text-link underline underline-offset-2 hover:text-link-hover";

// Pulls a section-top kolam up into the band's padding, with as much space
// below it as above, so the heading moves down only a little.
const KOLAM_GAP = "-mt-6 mb-8 sm:-mt-10 sm:mb-10";

export default async function AwarenessPage() {
  const t = await getTranslations("awareness");

  const pledgeLabels: PledgeLabels = {
    name: t("pledge.name"),
    nameHint: t("pledge.nameHint"),
    animal: t("pledge.animal"),
    promise: t("pledge.promise"),
    preview: t("pledge.preview"),
    download: t("pledge.download"),
    share: t("pledge.share"),
    privacy: t("pledge.privacy"),
    cardTitle: t("pledge.cardTitle"),
    cardWithName: t.raw("pledge.cardWithName") as string,
    cardNoName: t("pledge.cardNoName"),
    cardNeighbour: t.raw("pledge.cardNeighbour") as string,
    cardQuote: t("pledge.cardQuote"),
    cardQuoteSource: t("pledge.cardQuoteSource"),
    shareTitle: t("pledge.shareTitle"),
    shareText: t("pledge.shareText"),
  };

  return (
    <>
      {/* 1. Intro: Goodall Q42 */}
      <Section hue="teal" tone="tint" className="pt-10 sm:pt-14">
        <div className="grid grid-cols-[minmax(0,1fr)] items-center gap-10 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:gap-14">
          <div>
            <PageHeader
              eyebrow={t("hero.eyebrow")}
              tile="teal"
              title={t("hero.title")}
              lead={t("hero.lead")}
            />
            <nav aria-label={t("hero.jump")} className="mt-8">
              <ul className="flex flex-wrap gap-2">
                {JUMPS.map(([id, key]) => (
                  <li key={id}>
                    <InPageLink
                      href={`#${id}`}
                      className="inline-flex min-h-11 items-center rounded-full border-2 border-teal-700/40 bg-surface px-4 font-semibold text-ink transition-colors hover:border-teal-700"
                    >
                      {t(`hero.${key}`)}
                    </InPageLink>
                  </li>
                ))}
              </ul>
            </nav>
          </div>
          {/* Text, quote, then photo: on phones the photo sits below the
              first screen, so text stays the LCP element (see /donate). From
              lg the photo takes the right column and the quote spans below. */}
          <TileDivider className="lg:col-span-2 lg:mt-2" />
          <QuoteFigure id="Q42" hue="teal" className="lg:col-span-2" />
          <Photo
            id="dog-vest-blanket-delhi"
            sizes="(min-width: 1024px) 460px, min(92vw, 512px)"
            preload
            frame="green"
            frameCorner="bottom-right"
            caption={t("hero.photoCaption")}
            className="aspect-4/3"
            figureClassName="mx-auto w-full max-w-lg lg:col-start-2 lg:row-start-1"
          />
        </div>
      </Section>

      {/* 2. Kindness calendar */}
      <Section hue="teal" id="month" labelledBy="month-title">
        {/* A kolam at the threshold of each plain section, drawn in the
            band's top padding. */}
        <KolamDivider className={KOLAM_GAP} />
        <div className="relative">
          <SectionHeading
            id="month-title"
            eyebrow={t("month.eyebrow")}
            tile="yellow"
            title={t("month.title")}
            lead={t("month.lead")}
          />
          <StickerScatter stickers={MONTH_STICKERS} />
        </div>
        <SeasonalCard id="now" headingLevel={3} className="mt-10" />
      </Section>

      {/* 3. Street neighbours */}
      <Section
        hue="teal"
        tone="tint"
        id="neighbours"
        labelledBy="neighbours-title"
      >
        <SectionHeading
          id="neighbours-title"
          eyebrow={t("neighbours.eyebrow")}
          tile="teal"
          title={t("neighbours.title")}
          lead={t("neighbours.lead")}
        />
        <p className="mt-6 inline-flex rounded-2xl bg-surface px-4 py-3 font-semibold text-ink shadow-warm">
          {t("neighbours.rule")}
        </p>
        {/* "Spot the neighbour": each ring links to a card below. */}
        <StreetScene className="mt-10" />
        <ul className="mt-10 grid grid-cols-1 gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
          {NEIGHBOURS.map((n) => (
            <li key={n.id}>
              <NeighbourCard n={n} />
            </li>
          ))}
          <li className="flex flex-col justify-center rounded-3xl bg-surface p-6 shadow-warm sm:col-span-2 sm:p-8">
            <p className="font-hand text-lead text-teal-800 dark:text-teal-300">
              {t("neighbours.bondNote")}
            </p>
            <QuoteFigure id="Q34" size="md" hue="yellow" className="mt-4" />
          </li>
        </ul>
      </Section>

      {/* 4. Kindness that helps: Tagore Q22 */}
      <Section hue="teal" id="kindness" labelledBy="helps-title">
        <KolamDivider dots={7} className={KOLAM_GAP} />
        <SectionHeading
          id="helps-title"
          eyebrow={t("helps.eyebrow")}
          tile="pink"
          title={t("helps.title")}
          lead={t("helps.lead")}
        />
        {/* Tagore's bird gives the fish "a lift in the air"; beside it, a
            sparrow gets what it really needs from the bread swap below: a
            shallow bowl of water to bathe in. It sits beside the quote from
            lg, under it before that. No overflow clipping here: the sparrow
            plays on a view timeline. */}
        <div className="mt-10 flex flex-col gap-8 lg:flex-row lg:items-center lg:justify-between lg:gap-10">
          <QuoteFigure id="Q22" size="md" hue="pink" />
          <LivingIllustration
            id="living-sparrow"
            trigger="middle"
            decorative
            className="w-48 max-w-full shrink-0 self-center sm:w-56"
          />
        </div>
        <ul className="mt-10 grid grid-cols-1 gap-4 md:grid-cols-2">
          {SWAPS.map((key) => (
            <li
              key={key}
              className="grid grid-cols-1 gap-3 rounded-3xl border-2 border-border bg-surface p-5 sm:grid-cols-2 sm:p-6"
            >
              <p>
                <span className="block text-sm font-semibold text-red-700 dark:text-red-400">
                  {t("helps.instead")}
                </span>
                <span className="text-ink-muted">
                  {t(`helps.pairs.${key}.instead`)}
                </span>
              </p>
              <p>
                <span className="block text-sm font-semibold text-green-700 dark:text-green-400">
                  {t("helps.try")}
                </span>
                <span className="font-semibold text-ink">
                  {t(`helps.pairs.${key}.try`)}
                </span>
              </p>
            </li>
          ))}
        </ul>
      </Section>

      {/* 5. If you find a hurt or scared animal */}
      <Section hue="teal" tone="tint" id="hurt" labelledBy="hurt-title">
        <SectionHeading
          id="hurt-title"
          eyebrow={t("hurt.eyebrow")}
          tile="red"
          title={t("hurt.title")}
          lead={t("hurt.lead")}
        />
        <ol className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {HURT_ANIMAL_KID_STEPS.map((step, i) => (
            <li
              key={step}
              className="flex items-start gap-4 rounded-3xl bg-surface p-5 shadow-warm"
            >
              <span
                aria-hidden="true"
                className={`grid size-12 shrink-0 place-items-center rounded-[22%] font-display text-h4 font-bold ${STEP_TILES[i]}`}
              >
                {i + 1}
              </span>
              <span className="min-w-0 pt-1 font-display text-lead leading-snug font-semibold text-ink wrap-anywhere">
                {step}
              </span>
            </li>
          ))}
        </ol>

        <div className="mt-10 grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
          <Callout tone="info" title={t("hurt.saveTitle")}>
            <p>{t("hurt.saveBody")}</p>
            <p>{t("hurt.save1962")}</p>
          </Callout>
          <Callout tone="warning" title={t("hurt.biteTitle")}>
            <p className="font-semibold">{t("hurt.biteKid")}</p>
            <Disclosure summary={t("hurt.biteGrownUps")}>
              <ol className="list-decimal space-y-2 pl-5">
                {BITE_FIRST_AID.map((s) => (
                  <li key={s.title}>
                    <strong>{s.title}:</strong> {s.text}
                  </li>
                ))}
              </ol>
            </Disclosure>
          </Callout>
        </div>

        <Disclosure summary={t("hurt.grownUps")} className="mt-6">
          <ol className="list-decimal space-y-3 pl-5">
            {HURT_ANIMAL_GROWN_UP.map((s) => (
              <li key={s.title}>
                <strong>{s.title}:</strong> {s.text}
              </li>
            ))}
          </ol>
          <p className="text-sm font-semibold">{t("hurt.sources")}</p>
          <ul className="space-y-1 text-sm">
            {RESCUE_SOURCES.map((s) => (
              <li key={s.url}>
                <a href={s.url} className={LINK}>
                  {s.label}
                </a>
              </li>
            ))}
          </ul>
        </Disclosure>
      </Section>

      {/* 6. What the law says: PCA s.3 */}
      <Section
        hue="teal"
        id="law"
        labelledBy="law-title"
        width="prose"
        innerClassName="relative"
      >
        <KolamDivider className={KOLAM_GAP} />
        {/* In the wide margins beside the prose column (xl and up). */}
        <StickerScatter stickers={LAW_STICKERS} />
        <SectionHeading
          id="law-title"
          eyebrow={t("law.eyebrow")}
          tile="blue"
          title={t("law.title")}
          lead={t("law.kid")}
        />
        <QuoteFigure id="Q04" size="md" hue="blue" className="mt-10" />
        <Disclosure summary={t("law.detailTitle")} className="mt-8">
          <p>{t("law.detail1")}</p>
          <p>{t("law.detail2")}</p>
          <p>
            <a href={PCA_ACT_URL} className={LINK}>
              {t("law.readAct")}
            </a>
          </p>
        </Disclosure>
      </Section>

      {/* 7. Kindness pledge card */}
      <Section hue="teal" tone="tint" id="pledge" labelledBy="pledge-title">
        <div className="grid grid-cols-1 items-center gap-10 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:gap-14">
          <SectionHeading
            id="pledge-title"
            eyebrow={t("pledge.eyebrow")}
            tile="green"
            title={t("pledge.title")}
            lead={t("pledge.lead")}
          />
          <HappyMosaic
            layout="pair"
            label={t("pledge.photosLabel")}
            className="max-sm:px-1"
            tiles={PLEDGE_PHOTOS.map(([id, key]) => ({
              id,
              caption: t(`pledge.photos.${key}`),
            }))}
          />
        </div>
        <div className="mt-10">
          <PledgeCard
            animals={NEIGHBOURS.map((n) => ({ id: n.id, label: n.name }))}
            promises={PROMISES.map((id) => ({
              id,
              label: t(`pledge.promises.${id}`),
            }))}
            labels={pledgeLabels}
          />
        </div>
        <QuoteFigure id="Q15" size="md" hue="green" gloss className="mt-14" />
      </Section>
    </>
  );
}
