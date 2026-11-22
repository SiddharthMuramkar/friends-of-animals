import { ArrowRight, Megaphone } from "lucide-react";
import type { Metadata } from "next";
import { SiteLink } from "@/components/site/site-link";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";

import { BadgeConstellation } from "@/components/showcase/badge-constellation";
import { CertificatePreview } from "@/components/showcase/certificate-preview";
import { cachedNow } from "@/components/showcase/clock";
import { CompetitionCard } from "@/components/showcase/competition-card";
import { GalleryFrames } from "@/components/showcase/gallery-frames";
import { HappyMosaic } from "@/components/showcase/happy-mosaic";
import { ImpactCounters } from "@/components/showcase/impact-counters";
import { JudgingPath } from "@/components/showcase/judging-path";
import { QuoteFigure } from "@/components/showcase/quote-figure";
import { SeasonalCard } from "@/components/showcase/seasonal-card";
import { StoryCard } from "@/components/showcase/story-card";
import { TwoDoors } from "@/components/showcase/two-doors";
import { ButtonLink } from "@/components/site/button-link";
import { Eyebrow, SectionHeading } from "@/components/site/heading";
import { ExplainState } from "@/components/site/explain-state";
import { Photo } from "@/components/site/photo";
import { SampleTag } from "@/components/site/sample-tag";
import { Section } from "@/components/site/section";
import { TileMarker } from "@/components/site/tile";
import { getSampleCompetitions, getSampleImpact } from "@/content/sample";
import { homeCompetitions } from "@/content/sample/selectors";
import { latestStories } from "@/content/stories";
import type { SiteImageId } from "@/lib/images";
import { ROUTES } from "@/lib/routes";
import { pageMetadata } from "@/lib/seo";

import {
  activeAnnouncement,
  HOME_LAYOUT,
  type HomeSectionKey,
  openAnnouncement,
  visibleSections,
} from "./_components/home-layout";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("home.meta");
  return pageMetadata({
    title: t("title"),
    description: t("description"),
    path: ROUTES.home.path,
    absoluteTitle: true,
  });
}

function MoreLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <SiteLink
      href={href}
      className="group mt-8 inline-flex min-h-11 items-center gap-2 font-semibold text-link underline decoration-2 underline-offset-4 hover:text-link-hover"
    >
      {children}
      <ArrowRight
        aria-hidden="true"
        className="size-5 transition-transform motion-safe:group-hover:translate-x-1"
      />
    </SiteLink>
  );
}

async function Announcement() {
  const t = await getTranslations("home.announcement");
  const a = activeAnnouncement(
    openAnnouncement(getSampleCompetitions()),
    await cachedNow()
  );
  if (!a) return null;
  return (
    <aside
      aria-label={t("link")}
      className="bg-yellow-100 text-neutral-900 dark:bg-yellow-950 dark:text-yellow-50"
    >
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 text-sm sm:px-6 sm:text-base">
        <SampleTag />
        <p className="flex items-start gap-2 font-semibold sm:items-center">
          <Megaphone
            aria-hidden="true"
            className="mt-0.5 size-4 shrink-0 sm:mt-0 sm:size-5"
          />
          {t("text", { name: a.name, closes: new Date(a.expiresAt) })}
        </p>
        <SiteLink
          href={`/competitions/${a.slug}`}
          className="inline-flex min-h-11 items-center underline decoration-2 underline-offset-4"
        >
          {t("link")}
        </SiteLink>
      </div>
    </aside>
  );
}

async function Hero() {
  const t = await getTranslations("home");
  const { hero } = HOME_LAYOUT;
  return (
    <section aria-labelledby="home-title" className="relative bg-surface-muted">
      {/* Tile field: a few loose logo-colour tiles, decorative. Only this
          layer clips, so the text and buttons can never be cut off. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 overflow-hidden"
      >
        <span className="absolute bottom-16 left-[4%] hidden size-5 -rotate-6 rounded-[22%] bg-teal-400 sm:block" />
        <span className="absolute right-[6%] bottom-8 hidden size-4 rotate-6 rounded-[22%] bg-pink-400 sm:block" />
      </div>
      <div className="relative mx-auto grid max-w-7xl grid-cols-[minmax(0,1fr)] items-center gap-7 px-4 py-5 sm:gap-12 sm:px-6 sm:py-16 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:gap-16 lg:py-16">
        <div>
          <Eyebrow tile="green">{t("hero.eyebrow")}</Eyebrow>
          <h1
            id="home-title"
            className="mt-2 font-display text-[clamp(2rem,1.25rem+3.75vw,2.75rem)] leading-[1.05] font-extrabold text-balance text-ink sm:mt-4 sm:text-display lg:text-[4.5rem]"
          >
            {t(hero.heading)}
          </h1>
          <p className="mt-3 max-w-prose text-base text-ink-muted max-sm:leading-6 sm:mt-6 sm:text-lead">
            {t(hero.subheading)}
          </p>
          <div className="mt-4 flex flex-wrap gap-2.5 sm:mt-8 sm:gap-3">
            <ButtonLink
              href={hero.primaryCta.href}
              size="lg"
              className="max-sm:min-h-11 max-sm:px-5 max-sm:py-1.5 max-sm:text-base"
            >
              {t(hero.primaryCta.label)}
            </ButtonLink>
            {hero.secondaryCta ? (
              <ButtonLink
                href={hero.secondaryCta.href}
                variant="secondary"
                size="lg"
                className="max-sm:min-h-11 max-sm:px-5 max-sm:py-1.5 max-sm:text-base"
              >
                {t(hero.secondaryCta.label)}
              </ButtonLink>
            ) : null}
          </div>
        </div>
        <div className="relative mx-auto w-full max-w-xl lg:mr-3 lg:max-w-none">
          <Photo
            id={hero.imageAssetId}
            sizes="(min-width: 1280px) 560px, (min-width: 1024px) 44vw, min(92vw, 576px)"
            preload
            frame="red"
            frameCorner="top-right"
            caption={t("hero.caption")}
            className="aspect-4/3 shadow-warm ring-8 ring-surface"
            figureClassName="lg:rotate-1"
          />
          <p
            aria-hidden="true"
            className="absolute -top-4 -left-2 hidden -rotate-6 rounded-2xl bg-yellow-300 px-4 py-1.5 font-hand text-lead text-neutral-900 shadow-warm sm:block lg:-left-6"
          >
            {t("hero.note")}
          </p>
        </div>
      </div>
    </section>
  );
}

async function Competitions() {
  const t = await getTranslations("home.competitions");
  const list = homeCompetitions(getSampleCompetitions());
  return (
    <Section labelledBy="home-comps" width="wide" hue="pink">
      <SectionHeading
        id="home-comps"
        eyebrow={t("eyebrow")}
        tile="pink"
        title={t("title")}
        lead={list.length > 0 ? t("lead") : undefined}
      />
      {list.length > 0 ? (
        <>
          <ul className="mt-10 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {list.map((c) => (
              <li key={c.slug} className="flex">
                <CompetitionCard
                  competition={c}
                  headingLevel={3}
                  className="w-full"
                />
              </li>
            ))}
            {list.length < 3 ? (
              <li className="flex">
                <SiteLink
                  href={ROUTES.competitions.path}
                  className="group flex w-full flex-col items-start justify-end gap-4 rounded-3xl border-2 border-dashed border-border-strong bg-section-pink p-6 transition-[border-color,translate] hover:border-ink motion-safe:hover:-translate-y-0.5"
                >
                  <span aria-hidden="true" className="flex gap-1.5">
                    <TileMarker hue="pink" size="lg" />
                    <TileMarker hue="yellow" size="lg" />
                  </span>
                  <span className="font-display text-h4 leading-tight font-bold text-ink">
                    {t("moreTitle")}
                  </span>
                  <span className="inline-flex min-h-11 items-center gap-2 font-semibold text-link underline decoration-2 underline-offset-4">
                    {t("all")}
                    <ArrowRight
                      aria-hidden="true"
                      className="size-5 transition-transform motion-safe:group-hover:translate-x-1"
                    />
                  </span>
                </SiteLink>
              </li>
            ) : null}
          </ul>
          {list.length >= 3 ? (
            <MoreLink href={ROUTES.competitions.path}>{t("all")}</MoreLink>
          ) : null}
        </>
      ) : (
        <ExplainState
          title={t("emptyTitle")}
          headingLevel="h3"
          back={{ href: ROUTES.schools.path, label: t("emptyBack") }}
          className="mt-10 max-w-3xl"
        >
          <p>{t("emptyBody")}</p>
        </ExplainState>
      )}
    </Section>
  );
}

async function HowItWorks() {
  const t = await getTranslations("home.how");
  return (
    <Section labelledBy="home-how" width="wide" tone="tint" hue="green">
      <SectionHeading
        id="home-how"
        eyebrow={t("eyebrow")}
        tile="green"
        title={t("title")}
        lead={t("lead")}
      />
      <TwoDoors id="home-doors" headingLevel={3} className="mt-10" />
      <JudgingPath compact headingLevel={3} className="mt-12" />
    </Section>
  );
}

async function WhyChildren() {
  const t = await getTranslations("home.why");
  return (
    <Section labelledBy="home-why" width="wide" hue="red">
      <div className="grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:items-center lg:gap-16">
        <div>
          <SectionHeading
            id="home-why"
            eyebrow={t("eyebrow")}
            tile="red"
            title={t("title")}
          />
          <p className="mt-5 max-w-prose text-lead text-ink-muted">
            {t("body")}
          </p>
        </div>
        <QuoteFigure id="Q32a" hue="red" />
      </div>
    </Section>
  );
}

async function Gallery() {
  const t = await getTranslations("home.gallery");
  return (
    <Section labelledBy="home-gallery" width="wide" tone="tint" hue="pink">
      <SectionHeading
        id="home-gallery"
        eyebrow={t("eyebrow")}
        tile="pink"
        title={t("title")}
        lead={t("lead")}
      />
      <GalleryFrames className="mt-10" />
      <CertificatePreview headingLevel={3} className="mt-16 sm:mt-20" />
    </Section>
  );
}

async function Impact() {
  const t = await getTranslations("home.impact");
  const impact = getSampleImpact();
  const counters = impact
    ? {
        ...impact,
        counters: impact.counters.filter((c) =>
          HOME_LAYOUT.counterKeys.includes(c.key)
        ),
      }
    : null;
  return (
    <Section labelledBy="home-impact" width="wide" hue="teal">
      <SectionHeading
        id="home-impact"
        eyebrow={t("eyebrow")}
        tile="teal"
        title={t("title")}
        lead={t("lead")}
      />
      {counters ? (
        <ImpactCounters impact={counters} headingLevel={3} className="mt-10" />
      ) : (
        <p className="mt-6 max-w-prose text-body text-ink">{t("emptyBody")}</p>
      )}
      <MoreLink href={ROUTES.impact.path}>{t("how")}</MoreLink>
    </Section>
  );
}

async function Stories() {
  const t = await getTranslations("home.stories");
  return (
    <Section labelledBy="home-stories" width="wide" tone="tint" hue="yellow">
      <SectionHeading
        id="home-stories"
        eyebrow={t("eyebrow")}
        tile="yellow"
        title={t("title")}
        lead={t("lead")}
      />
      <ul className="mt-10 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {latestStories(3).map((story) => (
          <li key={story.slug} className="flex">
            <StoryCard story={story} headingLevel={3} className="w-full" />
          </li>
        ))}
      </ul>
      <MoreLink href={ROUTES.stories.path}>{t("all")}</MoreLink>
    </Section>
  );
}

async function Seasonal() {
  const t = await getTranslations("home.seasonal");
  return (
    <Section width="wide" hue="teal" className="py-10 sm:py-14">
      <SeasonalCard id="home-seasonal" headingLevel={2} />
      <MoreLink href={ROUTES.awareness.path}>{t("more")}</MoreLink>
    </Section>
  );
}

async function Badges() {
  const t = await getTranslations("home.badges");
  return (
    <Section labelledBy="home-badges" width="wide" tone="tint" hue="blue">
      <Eyebrow tile="blue" className="mb-3">
        {t("eyebrow")}
      </Eyebrow>
      <BadgeConstellation id="home-badges" headingLevel={2} />
      <MoreLink href={ROUTES.about.path}>{t("more")}</MoreLink>
    </Section>
  );
}

async function Donate() {
  const t = await getTranslations("home.donate");
  return (
    <Section labelledBy="home-donate" width="wide" hue="red">
      <div className="relative rounded-3xl bg-section-red p-6 sm:p-10 lg:p-14">
        {/* In flow on phones, so the tiles can't cover the eyebrow. */}
        <div
          aria-hidden="true"
          className="flex justify-end gap-1.5 max-sm:mb-3 sm:absolute sm:top-6 sm:right-6"
        >
          <TileMarker hue="red" size="lg" />
          <TileMarker hue="green" size="lg" />
          <TileMarker hue="blue" size="lg" />
        </div>
        <SectionHeading
          id="home-donate"
          eyebrow={t("eyebrow")}
          tile="red"
          title={t("title")}
          lead={t("body")}
        />
        <ButtonLink href={ROUTES.donate.path} size="lg" className="mt-8">
          {t("cta")}
        </ButtonLink>
      </div>
    </Section>
  );
}

// Darwin's line is about young animals playing, so the prints are puppies
// and kittens at play, three of each.
const JOY_PHOTOS = [
  ["kittens-basket-guwahati", "basket"],
  ["dogs-lalbagh-play", "mum"],
  ["kittens-play-lalakapa", "wrestle"],
  ["kitten-tree-peekaboo", "peekaboo"],
  ["puppies-kerala-grass", "slipper"],
  ["puppy-white-running", "running"],
] as const satisfies readonly (readonly [SiteImageId, string])[];

async function Joy() {
  const t = await getTranslations("home.joy");
  return (
    <Section labelledBy="home-joy" width="wide" tone="tint" hue="yellow">
      <HappyMosaic
        layout="around"
        tiles={JOY_PHOTOS.map(([id, key]) => ({
          id,
          caption: t(`photos.${key}`),
        }))}
      >
        <SectionHeading
          id="home-joy"
          eyebrow={t("eyebrow")}
          tile="yellow"
          title={t("title")}
        />
        <QuoteFigure id="Q36" hue="yellow" size="md" className="mt-8" />
      </HappyMosaic>
    </Section>
  );
}

const SECTIONS: Record<HomeSectionKey, () => Promise<ReactNode>> = {
  competitions: Competitions,
  howItWorks: HowItWorks,
  whyChildren: WhyChildren,
  gallery: Gallery,
  impact: Impact,
  stories: Stories,
  seasonal: Seasonal,
  badges: Badges,
  donate: Donate,
  joy: Joy,
  // Upcoming events: not built yet.
  events: async () => null,
};

export default function Page() {
  return (
    <>
      <Announcement />
      <Hero />
      {visibleSections(HOME_LAYOUT).map((key) => {
        const Block = SECTIONS[key];
        return <Block key={key} />;
      })}
    </>
  );
}
