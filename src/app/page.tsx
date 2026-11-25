import { ArrowRight, Megaphone } from "lucide-react";
import type { Metadata } from "next";
import { SiteLink } from "@/components/site/site-link";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";

import { AiMark } from "@/components/art/ai-mark";
import { Illustration } from "@/components/art/illustration";
import { LivingIllustration } from "@/components/art/living-illustration";
import { type Sticker, StickerScatter } from "@/components/art/sticker-scatter";
import { BadgeConstellation } from "@/components/showcase/badge-constellation";
import { CertificatePreview } from "@/components/showcase/certificate-preview";
import { cachedNow } from "@/components/showcase/clock";
import { fromSample } from "@/components/competitions/model";
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
import { getSampleCompetitions } from "@/content/sample";
import { homeCompetitions } from "@/content/sample/selectors";
import type { SiteImageId } from "@/lib/images";
import { ROUTES } from "@/lib/routes";
import { pageMetadata } from "@/lib/seo";
import { isSampleContentEnabled } from "@/lib/site";
import { cn } from "@/lib/utils";
import { CmsDraftPreview } from "@/app/_components/cms-draft-preview";
import { Live } from "@/components/site/live";
import {
  type HomePage,
  loadHomePage,
  loadPublishedHomePage,
  seedHomePage,
} from "@/server/modules/cms/site-pages";
import { loadLatestPublishedPosts } from "@/server/modules/cms/posts/loaders";

import {
  activeAnnouncement,
  type HomeLayout,
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

// A build-time shell can be replaced by the live CMS document. It displays
// the current kindness tip, but its month controls appear only in the live
// content so there are never two competing radio groups during streaming.
type BlockProps = HomePage & { streamingFallback?: true };

// The hero's columns and its photo's column. The sleeping dog's layer uses
// them too, so the dog keeps to the photo's lower-left corner.
const HERO_COLUMNS =
  "mx-auto max-w-7xl px-4 sm:px-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:gap-16";
const HERO_PHOTO_COLUMN = "mx-auto w-full max-w-xl lg:mr-3 lg:max-w-none";

function Hero({ home }: { home: HomeLayout }) {
  const { hero } = home;
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
        {/* An Indie dog naps on the band's floor, its tail tucked under the
            photo's lower-left corner and its head clear of the caption and
            the buttons (any wider and an ear runs into the caption). It
            wakes over the first 40% of a screen of scroll. Only from xl:
            narrower, it would cover the teal tile, crowd the buttons or
            float below the caption, and on tablets it would lie below the
            fold. It sits right under "Children's art…", so it carries the
            visible AI mark: no one should take it for a child's drawing
            (ADR 0003). Screen readers skip this whole layer. */}
        <div className={cn(HERO_COLUMNS, "hidden h-full xl:grid")}>
          <div
            className={cn(HERO_PHOTO_COLUMN, "relative h-full lg:col-start-2")}
          >
            <span className="absolute bottom-0 -left-28 w-30">
              <LivingIllustration
                id="living-dog"
                trigger="page"
                decorative
                className="w-full"
              />
              <AiMark className="absolute bottom-3 left-full ms-1" />
            </span>
          </div>
        </div>
      </div>
      <div
        className={cn(
          "relative grid grid-cols-[minmax(0,1fr)] items-center gap-7 py-5 sm:gap-12 sm:py-16 lg:py-16",
          HERO_COLUMNS
        )}
      >
        <div>
          <Eyebrow tile="green">{hero.eyebrow}</Eyebrow>
          <h1
            id="home-title"
            className="mt-2 font-display text-[clamp(2rem,1.25rem+3.75vw,2.75rem)] leading-[1.05] font-extrabold text-balance text-ink sm:mt-4 sm:text-display lg:text-[4.5rem]"
          >
            {hero.heading}
          </h1>
          <p className="mt-3 max-w-prose text-base text-ink-muted max-sm:leading-6 sm:mt-6 sm:text-lead">
            {hero.subheading}
          </p>
          <div className="mt-4 flex flex-wrap gap-2.5 sm:mt-8 sm:gap-3">
            <ButtonLink
              href={hero.primaryCta.href}
              size="lg"
              className="max-sm:min-h-11 max-sm:px-5 max-sm:py-1.5 max-sm:text-base"
            >
              {hero.primaryCta.label}
            </ButtonLink>
            {hero.secondaryCta ? (
              <ButtonLink
                href={hero.secondaryCta.href}
                variant="secondary"
                size="lg"
                className="max-sm:min-h-11 max-sm:px-5 max-sm:py-1.5 max-sm:text-base"
              >
                {hero.secondaryCta.label}
              </ButtonLink>
            ) : null}
          </div>
        </div>
        <div className={cn("relative", HERO_PHOTO_COLUMN)}>
          <Photo
            id={hero.imageAssetId}
            sizes="(min-width: 1280px) 560px, (min-width: 1024px) 44vw, min(92vw, 576px)"
            preload
            frame="red"
            frameCorner="top-right"
            caption={hero.caption || undefined}
            className="aspect-4/3 shadow-warm ring-8 ring-surface"
            figureClassName="lg:rotate-1"
          />
          {hero.note ? (
            <p
              aria-hidden="true"
              className="absolute -top-4 -left-2 hidden -rotate-6 rounded-2xl bg-yellow-300 px-4 py-1.5 font-hand text-lead text-neutral-900 shadow-warm sm:block lg:-left-6"
            >
              {hero.note}
            </p>
          ) : null}
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
                  competition={fromSample(c)}
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
                  <span className="max-w-full font-display text-h4 leading-tight font-bold text-ink">
                    {t("moreTitle")}
                  </span>
                  <span className="inline-flex min-h-11 max-w-full items-center gap-2 font-semibold text-link underline decoration-2 underline-offset-4">
                    <span className="min-w-0">{t("all")}</span>
                    <ArrowRight
                      aria-hidden="true"
                      className="size-5 shrink-0 transition-transform motion-safe:group-hover:translate-x-1"
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
          art="wait-horizon-myna"
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
      <div className="flex flex-wrap items-end gap-3">
        <SectionHeading
          id="home-how"
          eyebrow={t("eyebrow")}
          tile="green"
          title={t("title")}
          lead={t("lead")}
          className="min-w-0 flex-[1_1_16rem]"
        />
        <Illustration
          id="sticker-palm-squirrel"
          sizes="(min-width: 640px) 96px, 64px"
          decorative
          className="pointer-events-none ms-auto w-[64px] max-w-full shrink-0 sm:w-[96px]"
        />
      </div>
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

async function Impact({ home, impact }: BlockProps) {
  const t = await getTranslations("home.impact");
  const counters = impact?.counters.length
    ? {
        ...impact,
        counters: impact.counters.filter((c) =>
          home.counterKeys.includes(c.key)
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
        <ImpactCounters
          impact={counters}
          sample={isSampleContentEnabled()}
          headingLevel={3}
          className="mt-10"
        />
      ) : (
        <p className="mt-6 max-w-prose text-body text-ink">{t("emptyBody")}</p>
      )}
      <MoreLink href={ROUTES.impact.path}>{t("how")}</MoreLink>
    </Section>
  );
}

// Doodles by the Stories heading: on phones and tablets one sits in the band's
// top padding, above the heading's right end; from lg, where the heading
// leaves the right side of the row empty, three sit there.
const STORY_STICKERS = [
  {
    id: "sticker-puppy",
    className:
      "-top-10 right-1 w-10 sm:-top-14 sm:w-12 lg:top-1 lg:right-6 lg:w-16",
    tilt: -8,
  },
  {
    id: "sticker-kitten",
    className: "hidden lg:top-22 lg:right-26 lg:block lg:w-14",
    tilt: 10,
  },
  {
    id: "sticker-sparrow-bowl",
    className: "hidden lg:-top-6 lg:right-40 lg:block lg:w-14",
    tilt: -12,
  },
] as const satisfies readonly Sticker[];

async function Stories() {
  const [t, posts] = await Promise.all([
    getTranslations("home.stories"),
    loadLatestPublishedPosts(3),
  ]);
  return (
    <Section labelledBy="home-stories" width="wide" tone="tint" hue="yellow">
      <div className="relative">
        <StickerScatter stickers={STORY_STICKERS} />
        <SectionHeading
          id="home-stories"
          eyebrow={t("eyebrow")}
          tile="yellow"
          title={t("title")}
          lead={t("lead")}
        />
      </div>
      <ul className="mt-10 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {posts.map((story) => (
          <li key={story.slug} className="flex">
            <StoryCard story={story} headingLevel={3} className="w-full" />
          </li>
        ))}
      </ul>
      <MoreLink href={ROUTES.stories.path}>{t("all")}</MoreLink>
    </Section>
  );
}

async function Seasonal({ streamingFallback }: BlockProps) {
  const t = await getTranslations("home.seasonal");
  return (
    <Section width="wide" hue="teal" className="py-10 sm:py-14">
      <SeasonalCard
        id={streamingFallback ? "home-seasonal-fallback" : "home-seasonal"}
        headingLevel={2}
        interactive={!streamingFallback}
      />
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

// Doodles round the joy heading, never on the prints: two in the band's top
// padding; from lg a sketchbook in the empty top of the right-hand column.
const JOY_STICKERS = [
  {
    id: "sticker-diya",
    className: "-top-9 right-2 w-12 sm:-top-13 sm:w-14",
    tilt: 12,
  },
  {
    id: "sticker-marigold",
    className: "-top-10 right-20 hidden w-10 sm:-top-14 sm:right-24 sm:block",
    tilt: -10,
  },
  {
    id: "sticker-sketchbook",
    className: "hidden lg:top-0 lg:-right-24 lg:block lg:w-14",
    tilt: 6,
  },
] as const satisfies readonly Sticker[];

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
        <div className="relative">
          <StickerScatter stickers={JOY_STICKERS} />
          <SectionHeading
            id="home-joy"
            eyebrow={t("eyebrow")}
            tile="yellow"
            title={t("title")}
          />
        </div>
        <QuoteFigure id="Q36" hue="yellow" size="md" className="mt-8" />
      </HappyMosaic>
    </Section>
  );
}

const SECTIONS: Record<
  HomeSectionKey,
  (props: BlockProps) => ReactNode | Promise<ReactNode>
> = {
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
  events: () => null,
};

function HomeContent(page: BlockProps) {
  return (
    <>
      {page.preview ? (
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <CmsDraftPreview {...page.preview} />
        </div>
      ) : null}
      <Hero home={page.home} />
      {visibleSections(page.home).map((key) => {
        const Block = SECTIONS[key];
        return <Block key={key} {...page} />;
      })}
    </>
  );
}

// The hero and sections come from the published home document. The static
// shell renders it once the server has regenerated the page, so the hero
// and its buttons are painted once; until then (the build's shell, which
// has no database) and in Draft Mode, the shell holds the seed copy and
// the document streams in at request time (see Live).
export default function Page() {
  return (
    <>
      <Announcement />
      <Live<BlockProps>
        fallback={{ ...seedHomePage(), streamingFallback: true }}
        load={loadHomePage}
        published={loadPublishedHomePage}
      >
        {(page) => <HomeContent {...page} />}
      </Live>
    </>
  );
}
