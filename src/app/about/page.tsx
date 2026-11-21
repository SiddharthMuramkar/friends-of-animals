import { Brush, Eye, Sprout } from "lucide-react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { BadgeConstellation } from "@/components/showcase/badge-constellation";
import { HappyMosaic } from "@/components/showcase/happy-mosaic";
import { NotAShelter } from "@/components/showcase/not-a-shelter";
import { QuoteFigure } from "@/components/showcase/quote-figure";
import { ButtonLink } from "@/components/site/button-link";
import { Disclosure } from "@/components/site/disclosure";
import { PageHeader, SectionHeading } from "@/components/site/heading";
import { Photo } from "@/components/site/photo";
import { Placeholder } from "@/components/site/placeholder";
import { RichBlocks } from "@/components/site/rich-blocks";
import { Section } from "@/components/site/section";
import { TileDivider, TileMarker } from "@/components/site/tile";
import type { SiteImageId } from "@/lib/images";
import { ROUTES } from "@/lib/routes";
import { pageMetadata } from "@/lib/seo";
import { cn } from "@/lib/utils";
import { getOrgFacts } from "@/server/cms/org-facts";
import { loadAbout } from "@/server/cms/site-pages";

import { EasyRead } from "@/components/site/easy-read";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("about.meta");
  return pageMetadata({
    title: t("title"),
    description: t("description"),
    path: ROUTES.about.path,
  });
}

// One icon per step of the about document's three, in order.
const HOW = [
  { key: "create", Icon: Brush, tile: "bg-blue-700 text-white" },
  { key: "share", Icon: Eye, tile: "bg-pink-400 text-neutral-900" },
  { key: "grow", Icon: Sprout, tile: "bg-green-700 text-white" },
] as const;

// The neighbours at the heart of it: one dog, two cats.
const HOW_PHOTOS = [
  ["cat-roof-bougainvillea", "roof"],
  ["dog-thrissur-happy-white", "ears"],
  ["cat-stretch-ahmedabad", "paws"],
] as const satisfies readonly (readonly [SiteImageId, string])[];

const PEOPLE_TILES = [
  "red",
  "green",
  "blue",
  "yellow",
  "teal",
  "pink",
] as const;

export default async function Page() {
  const t = await getTranslations("about");
  const about = await loadAbout();
  const facts = await getOrgFacts();

  return (
    <>
      <Section
        hue="blue"
        tone="tint"
        width="wide"
        className="py-12 sm:py-16 lg:py-20"
      >
        <div className="grid grid-cols-[minmax(0,1fr)] items-center gap-10 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:gap-14">
          <div>
            <PageHeader
              eyebrow={about.hero.eyebrow}
              tile="blue"
              title={about.hero.title}
              lead={about.hero.lead}
            />
            <EasyRead label={t("easyLabel")} className="mt-6">
              <p>{about.hero.easy}</p>
            </EasyRead>
          </div>
          {/* On phones a half-width print, smaller than the lead text, so
              text stays the LCP element (see /contact). */}
          <Photo
            id="dogs-pariah-yelahanka-park"
            sizes="(min-width: 1280px) 520px, (min-width: 1024px) 42vw, (min-width: 640px) 92vw, 46vw"
            preload
            frame="blue"
            frameCorner="bottom-left"
            className="aspect-4/3 shadow-warm"
            figureClassName="ml-auto mr-2 w-1/2 -rotate-2 sm:mx-0 sm:mr-0 sm:w-full sm:rotate-0"
          />
        </div>
      </Section>

      {/* Opener: Article 51A(g), in English and Hindi, and what it means. */}
      <Section labelledBy="about-duty" width="wide" hue="blue">
        <SectionHeading
          id="about-duty"
          eyebrow={about.duty.eyebrow}
          tile="blue"
          title={about.duty.title}
          lead={about.duty.body}
        />
        <div className="mt-10 grid gap-10 lg:grid-cols-2 lg:gap-14">
          <QuoteFigure id="Q01" hue="blue" />
          <QuoteFigure id="Q02" hue="green" size="md" />
        </div>
        <p className="mt-12 max-w-prose text-lead text-ink">
          {about.duty.court}
        </p>
        <QuoteFigure id="Q03" hue="red" size="md" className="mt-6 max-w-3xl" />
      </Section>

      {/* Vision and mission, in FOA's own words. */}
      <Section width="wide" tone="tint" hue="blue">
        <div className="grid gap-6 md:grid-cols-2">
          {(
            [
              ["visionTitle", "vision", "yellow"],
              ["missionTitle", "mission", "teal"],
            ] as const
          ).map(([title, body, tile]) => (
            <div
              key={body}
              className="rounded-3xl border-2 border-border bg-surface p-6 shadow-warm sm:p-8"
            >
              <h2 className="flex items-center gap-3 text-h3">
                <TileMarker hue={tile} size="lg" />
                {about.vision[title]}
              </h2>
              <p className="mt-4 font-display text-h5 leading-snug font-semibold text-ink">
                {about.vision[body]}
              </p>
            </div>
          ))}
        </div>
      </Section>

      {/* Why compassion is a skill. */}
      <Section labelledBy="about-skill" width="wide" hue="blue">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:items-center lg:gap-16">
          <Photo
            id="cat-lentils-west-bengal"
            sizes="(min-width: 1024px) 40vw, 92vw"
            frame="green"
            frameCorner="top-left"
            className="aspect-square"
            figureClassName="order-last lg:order-first"
          />
          <div>
            <SectionHeading
              id="about-skill"
              eyebrow={about.skill.eyebrow}
              tile="green"
              title={about.skill.title}
            />
            <EasyRead label={t("easyLabel")} className="mt-6">
              <p>{about.skill.easy}</p>
            </EasyRead>
            <div className="mt-6 max-w-prose space-y-4 text-body text-ink">
              <RichBlocks blocks={about.skill.body} facts={facts} />
            </div>
            <Disclosure
              summary={about.skill.detailSummary}
              className="mt-6 max-w-prose"
            >
              <RichBlocks blocks={about.skill.detail} facts={facts} />
            </Disclosure>
          </div>
        </div>
      </Section>

      {/* Ashoka heritage strip. */}
      <Section
        labelledBy="about-ashoka"
        width="default"
        tone="tint"
        hue="yellow"
      >
        <div className="grid gap-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:items-center lg:gap-14">
          <SectionHeading
            id="about-ashoka"
            eyebrow={about.ashoka.eyebrow}
            tile="yellow"
            title={about.ashoka.title}
            lead={about.ashoka.body}
          />
          <QuoteFigure id="Q11" hue="yellow" size="md" />
        </div>
      </Section>

      {/* How FOA works: creativity → awareness → compassion. */}
      <Section labelledBy="about-how" width="wide" hue="blue">
        <SectionHeading
          id="about-how"
          eyebrow={about.how.eyebrow}
          tile="blue"
          title={about.how.title}
        />
        <ol className="mt-10 grid gap-6 md:grid-cols-3">
          {HOW.map(({ key, Icon, tile }, i) => (
            <li
              key={key}
              className="relative rounded-3xl border-2 border-border bg-surface p-6 shadow-warm"
            >
              <span
                aria-hidden="true"
                className={cn(
                  "grid size-14 place-items-center rounded-[22%]",
                  tile
                )}
              >
                <Icon className="size-7" strokeWidth={2.25} />
              </span>
              <h3 className="mt-4 text-h4">{about.how.steps[i].title}</h3>
              <p className="mt-2 text-body text-ink-muted">
                {about.how.steps[i].body}
              </p>
            </li>
          ))}
        </ol>
        <h3 className="mt-16 flex items-center gap-3 text-h3 sm:mt-20">
          <TileMarker hue="yellow" size="lg" />
          {t("how.photos.title")}
        </h3>
        <HappyMosaic
          layout="row3"
          tiles={HOW_PHOTOS.map(([id, key]) => ({
            id,
            caption: t(`how.photos.${key}`),
          }))}
          className="mt-10"
        />
      </Section>

      {/* Stakeholders and the not-a-shelter diagram. */}
      <Section labelledBy="about-people" width="wide" tone="tint" hue="blue">
        <SectionHeading
          id="about-people"
          eyebrow={about.people.eyebrow}
          tile="teal"
          title={about.people.title}
          lead={about.people.lead}
        />
        <ul className="mt-8 flex flex-wrap gap-3">
          {about.people.items.map((item, i) => (
            <li
              key={item}
              className="inline-flex min-h-11 items-center gap-2.5 rounded-full border-2 border-border bg-surface px-4 py-2 font-semibold text-ink"
            >
              <TileMarker
                hue={PEOPLE_TILES[i % PEOPLE_TILES.length]}
                size="sm"
              />
              {item}
            </li>
          ))}
        </ul>
        <TileDivider className="my-14" />
        <SectionHeading
          eyebrow={t("shelter.eyebrow")}
          tile="red"
          title={<span className="text-h3">{t("shelter.title")}</span>}
          lead={t("shelter.lead")}
        />
        <NotAShelter headingLevel={3} className="mt-10" />
      </Section>

      {/* Badges. */}
      <Section id="badges" labelledBy="about-badges" width="wide" hue="blue">
        <BadgeConstellation id="about-badges" headingLevel={2} />
      </Section>

      {/* Six-month objectives. */}
      <Section
        labelledBy="about-objectives"
        width="wide"
        tone="tint"
        hue="blue"
      >
        <SectionHeading
          id="about-objectives"
          eyebrow={about.objectives.eyebrow}
          tile="green"
          title={about.objectives.title}
        />
        <ol className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {about.objectives.items.map((o, i) => (
            <li
              key={o.title}
              className="rounded-3xl border-2 border-border bg-surface p-5"
            >
              <span
                aria-hidden="true"
                className="grid size-10 place-items-center rounded-[22%] bg-blue-700 font-display text-lead font-bold text-white"
              >
                {i + 1}
              </span>
              <h3 className="mt-3 text-h5 font-sans font-bold">{o.title}</h3>
              <p className="mt-1.5 text-sm text-ink-muted">{o.body}</p>
            </li>
          ))}
        </ol>
      </Section>

      {/* Transparency promise and name line. */}
      <Section labelledBy="about-promise" width="default" hue="blue">
        <div className="rounded-3xl border-2 border-ink bg-surface p-6 shadow-warm sm:p-10">
          <SectionHeading
            id="about-promise"
            eyebrow={about.transparency.eyebrow}
            tile="red"
            title={about.transparency.title}
            lead={about.transparency.body}
          />
          <p className="mt-6 flex flex-wrap items-center gap-2 text-body text-ink">
            {t("transparency.registration")}
            <Placeholder fact={facts.registration.type} />
            <Placeholder fact={facts.registration.number} />
          </p>
          <ButtonLink
            href={ROUTES.donate.path}
            variant="secondary"
            className="mt-8"
          >
            {t("transparency.cta")}
          </ButtonLink>
        </div>
        <p className="mt-10 max-w-prose text-sm text-ink-muted">{about.name}</p>
      </Section>
    </>
  );
}
