import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";

import { QuoteFigure } from "@/components/showcase/quote-figure";
import { SeasonalCard } from "@/components/showcase/seasonal-card";
import { Callout } from "@/components/site/callout";
import { Disclosure } from "@/components/site/disclosure";
import { PageHeader, SectionHeading } from "@/components/site/heading";
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
import { SEASONAL_MONTHS } from "@/content/awareness/seasonal";
import { ROUTES } from "@/lib/routes";
import { pageMetadata } from "@/lib/seo";

import { NeighbourCard } from "./_components/neighbour-card";
import { PledgeCard, type PledgeLabels } from "./_components/pledge-card";

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

const SWAPS = ["milk", "bread", "sweets", "chick", "holi", "manja"] as const;
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

export default async function AwarenessPage() {
  const t = await getTranslations("awareness");
  const format = await getFormatter();
  const monthName = (m: number) =>
    format.dateTime(new Date(Date.UTC(2026, m - 1, 15)), { month: "long" });

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
        <div className="grid items-center gap-10 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:gap-14">
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
                    <a
                      href={`#${id}`}
                      className="inline-flex min-h-11 items-center rounded-full border-2 border-teal-700/40 bg-surface px-4 font-semibold text-ink transition-colors hover:border-teal-700"
                    >
                      {t(`hero.${key}`)}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          </div>
          <Photo
            id="dog-vest-blanket-delhi"
            sizes="(min-width: 1024px) 460px, 92vw"
            preload
            frame="green"
            frameCorner="bottom-right"
            caption={t("hero.photoCaption")}
            className="aspect-4/3"
          />
        </div>
        <TileDivider className="my-12" />
        <QuoteFigure id="Q42" hue="teal" />
      </Section>

      {/* 2. This month, and all twelve */}
      <Section hue="teal" id="month" labelledBy="month-title">
        <SectionHeading
          id="month-title"
          eyebrow={t("month.eyebrow")}
          tile="yellow"
          title={t("month.title")}
          lead={t("month.lead")}
        />
        <SeasonalCard id="now" headingLevel={3} className="mt-10" />
        <h3 className="mt-14 text-h3 text-(--section-heading)">
          {t("month.allTitle")}
        </h3>
        <p className="mt-2 text-ink-muted">{t("month.allLead")}</p>
        <div className="mt-6 space-y-3">
          {SEASONAL_MONTHS.map((m) => (
            <Disclosure
              key={m.month}
              name="months"
              summary={
                <span className="flex flex-wrap items-baseline gap-x-3">
                  <span className="font-display text-h5 text-(--section-heading)">
                    {monthName(m.month)}
                  </span>
                  <span className="font-normal text-ink-muted">{m.title}</span>
                </span>
              }
            >
              <SeasonalCard
                month={m.month}
                id="year"
                headingLevel={4}
                className="border-0 p-0 shadow-none sm:p-0"
              />
            </Disclosure>
          ))}
        </div>
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
        <ul className="mt-10 grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
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
        <SectionHeading
          id="helps-title"
          eyebrow={t("helps.eyebrow")}
          tile="pink"
          title={t("helps.title")}
          lead={t("helps.lead")}
        />
        <QuoteFigure id="Q22" size="md" hue="pink" className="mt-10" />
        <ul className="mt-10 grid gap-4 md:grid-cols-2">
          {SWAPS.map((key) => (
            <li
              key={key}
              className="grid gap-3 rounded-3xl border-2 border-border bg-surface p-5 sm:grid-cols-2 sm:p-6"
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
        <ol className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
              <span className="pt-1 font-display text-lead leading-snug font-semibold text-ink">
                {step}
              </span>
            </li>
          ))}
        </ol>

        <div className="mt-10 grid items-start gap-6 lg:grid-cols-2">
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
      <Section hue="teal" id="law" labelledBy="law-title" width="prose">
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
        <SectionHeading
          id="pledge-title"
          eyebrow={t("pledge.eyebrow")}
          tile="green"
          title={t("pledge.title")}
          lead={t("pledge.lead")}
        />
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
