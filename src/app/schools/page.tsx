import { CheckCircle2 } from "lucide-react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { JudgingPath } from "@/components/showcase/judging-path";
import { QuoteFigure } from "@/components/showcase/quote-figure";
import { ButtonLink } from "@/components/site/button-link";
import { ContactFact } from "@/components/site/contact-fact";
import { ExplainState } from "@/components/site/explain-state";
import { PageHeader, SectionHeading } from "@/components/site/heading";
import { Photo } from "@/components/site/photo";
import { Section } from "@/components/site/section";
import { type TileHue, TileMarker } from "@/components/site/tile";
import { ROUTES } from "@/lib/routes";
import { pageMetadata } from "@/lib/seo";
import { isFactShown, SITE } from "@/lib/site";
import { cn } from "@/lib/utils";

import { EasyRead } from "@/components/site/easy-read";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("schools.meta");
  return pageMetadata({
    title: t("title"),
    description: t("description"),
    path: ROUTES.schools.path,
  });
}

// Step numbers on tiles, in logo order then the mixes.
const STEP_TILES = [
  "bg-red-600 text-white",
  "bg-green-700 text-white",
  "bg-blue-700 text-white",
  "bg-yellow-300 text-neutral-900",
  "bg-teal-400 text-neutral-900",
] as const;

const PROVIDE_TILES: TileHue[] = [
  "green",
  "blue",
  "red",
  "yellow",
  "pink",
  "teal",
];

type Item = { title: string; body: string };

export default async function Page() {
  const t = await getTranslations("schools");
  const steps = t.raw("steps.items") as Item[];
  const duties = t.raw("coordinator.items") as string[];
  const provides = t.raw("provides.items") as Item[];

  return (
    <>
      <Section
        hue="green"
        tone="tint"
        width="wide"
        className="py-12 sm:py-16 lg:py-20"
      >
        {/* Text, quote, then photo: on phones the photo sits below the first
            screen, so the heading text stays the LCP element (see /donate).
            From lg the photo takes the right column and the quote spans
            below. */}
        <div className="grid grid-cols-[minmax(0,1fr)] items-center gap-10 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:gap-14">
          <div>
            <PageHeader
              eyebrow={t("hero.eyebrow")}
              tile="green"
              title={t("hero.title")}
              lead={t("hero.lead")}
            />
            <EasyRead label={t("easyLabel")} className="mt-6">
              <p>{t("hero.easy")}</p>
            </EasyRead>
          </div>
          <QuoteFigure
            id="Q29"
            hue="green"
            size="md"
            className="mt-4 max-w-4xl lg:col-span-2 lg:mt-0"
          />
          <Photo
            id="classroom-chennai-smart-class"
            sizes="(min-width: 1280px) 540px, (min-width: 1024px) 42vw, min(92vw, 512px)"
            preload
            frame="green"
            frameCorner="top-right"
            className="aspect-4/3 shadow-warm"
            figureClassName="mx-auto w-full max-w-lg lg:col-start-2 lg:row-start-1 lg:max-w-none"
          />
        </div>
      </Section>

      {/* Five steps, from registering a school to sending the shortlist. */}
      <Section labelledBy="schools-steps" width="wide" hue="green">
        <SectionHeading
          id="schools-steps"
          eyebrow={t("steps.eyebrow")}
          tile="green"
          title={t("steps.title")}
        />
        <ol className="mt-10 grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-5">
          {steps.map((s, i) => (
            <li
              key={s.title}
              className="relative flex flex-col rounded-3xl border-2 border-border bg-surface p-5 shadow-warm"
            >
              <span
                aria-hidden="true"
                className={cn(
                  "grid size-12 place-items-center rounded-[22%] font-display text-h4 font-bold",
                  STEP_TILES[i]
                )}
              >
                {i + 1}
              </span>
              <h3 className="mt-4 font-sans text-h5 font-bold">{s.title}</h3>
              <p className="mt-2 text-sm text-ink-muted">{s.body}</p>
            </li>
          ))}
        </ol>
      </Section>

      {/* Coordinator and what FOA provides. */}
      <Section labelledBy="schools-coord" width="wide" tone="tint" hue="green">
        <div className="grid grid-cols-1 gap-12 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16">
          <div>
            <SectionHeading
              id="schools-coord"
              eyebrow={t("coordinator.eyebrow")}
              tile="blue"
              title={t("coordinator.title")}
            />
            <p className="mt-5 text-lead text-ink">{t("coordinator.lead")}</p>
            <ul className="mt-4 space-y-3">
              {duties.map((d) => (
                <li key={d} className="flex gap-3 text-body text-ink">
                  <CheckCircle2
                    aria-hidden="true"
                    className="mt-0.5 size-6 shrink-0 text-green-700 dark:text-green-400"
                  />
                  {d}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h2 id="schools-provides" className="text-h3">
              {t("provides.title")}
            </h2>
            <ul className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
              {provides.map((p, i) => (
                <li
                  key={p.title}
                  className="rounded-3xl border-2 border-border bg-surface p-5"
                >
                  <h3 className="flex items-center gap-2.5 font-sans text-h5 font-bold">
                    <TileMarker hue={PROVIDE_TILES[i % PROVIDE_TILES.length]} />
                    <span className="min-w-0">{p.title}</span>
                  </h3>
                  <p className="mt-2 text-sm text-ink-muted">{p.body}</p>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Section>

      {/* Already in your curriculum. */}
      <Section labelledBy="schools-curriculum" width="wide" hue="green">
        <div className="rounded-3xl border-2 border-green-700 bg-surface p-6 shadow-warm dark:border-green-400 sm:p-10">
          <SectionHeading
            id="schools-curriculum"
            eyebrow={t("curriculum.eyebrow")}
            tile="green"
            title={t("curriculum.title")}
            lead={t("curriculum.lead")}
          />
          <div className="mt-10 grid grid-cols-1 gap-10 lg:grid-cols-2">
            <div>
              <p className="text-sm font-bold text-ink">
                {t("curriculum.ncf")}
              </p>
              <QuoteFigure id="Q08" hue="green" size="md" className="mt-4" />
            </div>
            <div>
              <p className="text-sm font-bold text-ink">
                {t("curriculum.nep")}
              </p>
              <QuoteFigure id="Q07" hue="blue" size="md" className="mt-4" />
            </div>
          </div>
        </div>
        <p className="mt-14 max-w-prose text-lead text-ink">
          {t("verma.lead")}
        </p>
        <QuoteFigure
          id="Q09"
          hue="yellow"
          size="md"
          className="mt-6 max-w-3xl"
        />
      </Section>

      {/* Where the work goes next. */}
      <Section width="wide" tone="tint" hue="green">
        <JudgingPath headingLevel={2} />
      </Section>

      {/* Call to action (registration is built later: explain, don't 404). */}
      <Section
        id="take-part"
        labelledBy="schools-cta"
        width="default"
        hue="green"
      >
        <SectionHeading
          id="schools-cta"
          eyebrow={t("contact.eyebrow")}
          tile="red"
          title={t("contact.title")}
          lead={t("contact.body")}
        />
        <ExplainState
          title={t("contact.openTitle")}
          headingLevel="h3"
          art="wait-calendar-pup"
          className="mt-10"
        >
          <p>{t("contact.openBody")}</p>
          {isFactShown(SITE.org.email) ? (
            <p className="flex flex-wrap items-center gap-2">
              {t("contact.contactLabel")}
              <ContactFact kind="email" fact={SITE.org.email} />
            </p>
          ) : null}
        </ExplainState>
        <ButtonLink href={ROUTES.contact.path} size="lg" className="mt-8">
          {t("contact.contactCta")}
        </ButtonLink>
      </Section>
    </>
  );
}
