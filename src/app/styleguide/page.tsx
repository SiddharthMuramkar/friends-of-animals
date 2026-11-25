import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { NextIntlClientProvider } from "next-intl";
import { messages } from "@/i18n/messages";
import { LOCALE } from "@/i18n/formats";
import { MediaViewer } from "@/components/media-viewer/media-viewer";
import { siteArt } from "@/lib/art";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { EmailOffCallout } from "@/app/(auth)/_components/email-off-callout";
import { SmsOffCallout } from "@/app/(auth)/_components/sms-off-callout";
import { AiMark } from "@/components/art/ai-mark";
import { ArtFigure } from "@/components/art/art-figure";
import { Illustration } from "@/components/art/illustration";
import { KolamDivider } from "@/components/art/kolam-divider";
import { LivingIllustration } from "@/components/art/living-illustration";
import { type Sticker, StickerScatter } from "@/components/art/sticker-scatter";
import { CertificatePreview } from "@/components/showcase/certificate-preview";
import { fromSample } from "@/components/competitions/model";
import { CompetitionCard } from "@/components/showcase/competition-card";
import { ImpactCounters } from "@/components/showcase/impact-counters";
import { JudgingPath } from "@/components/showcase/judging-path";
import { QuoteFigure } from "@/components/showcase/quote-figure";
import { SeasonalCard } from "@/components/showcase/seasonal-card";
import { StatusChip } from "@/components/showcase/status-chip";
import { StoryCard } from "@/components/showcase/story-card";
import { TwoDoors } from "@/components/showcase/two-doors";
import { ButtonLink } from "@/components/site/button-link";
import { Callout } from "@/components/site/callout";
import { Chip } from "@/components/site/chip";
import { Disclosure } from "@/components/site/disclosure";
import { ExplainState } from "@/components/site/explain-state";
import { PageHeader, SectionHeading } from "@/components/site/heading";
import { InPageLink } from "@/components/site/in-page-link";
import { Placeholder } from "@/components/site/placeholder";
import { SampleTag } from "@/components/site/sample-tag";
import { Section } from "@/components/site/section";
import { type TileHue, TileDivider, TileMarker } from "@/components/site/tile";
import { getSampleCompetitions, getSampleImpact } from "@/content/sample";
import { COMPETITION_STATUSES } from "@/content/sample/model";
import { ROUTES } from "@/lib/routes";
import { pageMetadata } from "@/lib/seo";
import { isSampleContentEnabled } from "@/lib/site";
import { WithOrgFacts } from "@/components/site/with-org-facts";
import { cn } from "@/lib/utils";
import { repoStoryCards } from "@/server/modules/cms/posts/repo-stories";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("styleguide.meta");
  return {
    ...pageMetadata({
      title: t("title"),
      description: t("description"),
      path: ROUTES.styleguide.path,
    }),
    robots: { index: false, follow: false },
  };
}

// Literal class names so Tailwind generates every swatch.
const SCALES = {
  red: [
    "bg-red-50",
    "bg-red-100",
    "bg-red-200",
    "bg-red-300",
    "bg-red-400",
    "bg-red-500",
    "bg-red-600",
    "bg-red-700",
    "bg-red-800",
    "bg-red-900",
    "bg-red-950",
  ],
  green: [
    "bg-green-50",
    "bg-green-100",
    "bg-green-200",
    "bg-green-300",
    "bg-green-400",
    "bg-green-500",
    "bg-green-600",
    "bg-green-700",
    "bg-green-800",
    "bg-green-900",
    "bg-green-950",
  ],
  blue: [
    "bg-blue-50",
    "bg-blue-100",
    "bg-blue-200",
    "bg-blue-300",
    "bg-blue-400",
    "bg-blue-500",
    "bg-blue-600",
    "bg-blue-700",
    "bg-blue-800",
    "bg-blue-900",
    "bg-blue-950",
  ],
  yellow: [
    "bg-yellow-50",
    "bg-yellow-100",
    "bg-yellow-200",
    "bg-yellow-300",
    "bg-yellow-400",
    "bg-yellow-500",
    "bg-yellow-600",
    "bg-yellow-700",
    "bg-yellow-800",
    "bg-yellow-900",
    "bg-yellow-950",
  ],
  teal: [
    "bg-teal-50",
    "bg-teal-100",
    "bg-teal-200",
    "bg-teal-300",
    "bg-teal-400",
    "bg-teal-500",
    "bg-teal-600",
    "bg-teal-700",
    "bg-teal-800",
    "bg-teal-900",
    "bg-teal-950",
  ],
  pink: [
    "bg-pink-50",
    "bg-pink-100",
    "bg-pink-200",
    "bg-pink-300",
    "bg-pink-400",
    "bg-pink-500",
    "bg-pink-600",
    "bg-pink-700",
    "bg-pink-800",
    "bg-pink-900",
    "bg-pink-950",
  ],
  neutral: [
    "bg-neutral-50",
    "bg-neutral-100",
    "bg-neutral-200",
    "bg-neutral-300",
    "bg-neutral-400",
    "bg-neutral-500",
    "bg-neutral-600",
    "bg-neutral-700",
    "bg-neutral-800",
    "bg-neutral-900",
    "bg-neutral-950",
  ],
} as const;
const STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];

const ROLES = [
  { key: "background", swatch: "bg-background" },
  { key: "surface", swatch: "bg-surface" },
  { key: "surfaceMuted", swatch: "bg-surface-muted" },
  { key: "ink", swatch: "bg-ink" },
  { key: "inkMuted", swatch: "bg-ink-muted" },
  { key: "primary", swatch: "bg-primary" },
  { key: "link", swatch: "bg-link" },
  { key: "focus", swatch: "bg-focus" },
] as const;

const SECTION_TINTS = [
  { key: "multi", bg: "bg-surface-muted", ink: "text-ink" },
  { key: "blue", bg: "bg-section-blue", ink: "text-section-blue-heading" },
  { key: "pink", bg: "bg-section-pink", ink: "text-section-pink-heading" },
  { key: "green", bg: "bg-section-green", ink: "text-section-green-heading" },
  { key: "teal", bg: "bg-section-teal", ink: "text-section-teal-heading" },
  {
    key: "yellow",
    bg: "bg-section-yellow",
    ink: "text-section-yellow-heading",
  },
  { key: "red", bg: "bg-section-red", ink: "text-section-red-heading" },
  { key: "neutral", bg: "bg-surface-muted", ink: "text-ink" },
] as const;

const TYPE = [
  { key: "display", cls: "font-display text-display font-bold" },
  { key: "h1", cls: "font-display text-h1 font-bold" },
  { key: "h2", cls: "font-display text-h2 font-bold" },
  { key: "h3", cls: "font-display text-h3 font-bold" },
  { key: "h4", cls: "font-display text-h4 font-bold" },
  { key: "h5", cls: "font-sans text-h5 font-bold" },
  { key: "lead", cls: "text-lead" },
  { key: "body", cls: "text-body max-w-prose" },
  { key: "small", cls: "text-sm" },
  { key: "hand", cls: "font-hand text-h4" },
  { key: "rupee", cls: "font-display text-h3 font-bold" },
] as const;

const SECTIONS = [
  { id: "colour", hue: "red" },
  { id: "type", hue: "green" },
  { id: "primitives", hue: "blue" },
  { id: "cards", hue: "yellow" },
  { id: "showcase", hue: "teal" },
  { id: "dark", hue: "pink" },
  { id: "illustrations", hue: "red" },
  { id: "viewer", hue: "teal" },
] as const satisfies readonly { id: string; hue: TileHue }[];

const HUES: TileHue[] = ["red", "green", "blue", "yellow", "teal", "pink"];

// On the demo box's edges, clear of its words at every width.
const STICKERS: readonly Sticker[] = [
  { id: "sticker-kitten", className: "-top-8 -left-2 w-14 sm:w-16", tilt: -8 },
  {
    id: "sticker-marigold",
    className: "-top-6 right-6 w-12 sm:w-14",
    tilt: 10,
  },
  {
    id: "sticker-diya",
    className: "-bottom-8 left-[38%] w-14 sm:w-18",
    tilt: -4,
  },
];

function Sub({
  title,
  children,
  className,
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mt-12 first:mt-8", className)}>
      <h3 className="flex items-center gap-2.5 font-sans text-h5 font-bold text-ink">
        <span
          aria-hidden="true"
          className="h-0.5 w-6 rounded-full bg-border-strong"
        />
        {title}
      </h3>
      <div className="mt-5">{children}</div>
    </div>
  );
}

export default async function Page() {
  // Test sites only.
  if (!isSampleContentEnabled()) notFound();
  const t = await getTranslations("styleguide");
  const competitions = getSampleCompetitions();
  const impact = getSampleImpact();

  return (
    <>
      <Section hue="multi" tone="tint" width="wide" className="py-14 sm:py-20">
        <PageHeader
          eyebrow={t("eyebrow")}
          tile="blue"
          title={t("title")}
          lead={t("lead")}
        />
        <nav aria-labelledby="sg-toc" className="mt-10">
          <h2 id="sg-toc" className="font-sans text-h5 font-bold text-ink">
            {t("onThisPage")}
          </h2>
          <ul className="mt-3 flex flex-wrap gap-2">
            {SECTIONS.map(({ id, hue }) => (
              <li key={id}>
                <InPageLink
                  href={`#${id}`}
                  className="inline-flex min-h-11 items-center gap-2 rounded-full border-2 border-border bg-surface px-4 font-semibold text-ink transition-[border-color,translate] hover:border-ink motion-safe:hover:-translate-y-0.5"
                >
                  <TileMarker hue={hue} size="sm" />
                  {t(`sections.${id}`)}
                </InPageLink>
              </li>
            ))}
          </ul>
        </nav>
      </Section>

      {/* Colour */}
      <Section id="colour" labelledBy="sg-colour" width="wide">
        <SectionHeading
          id="sg-colour"
          eyebrow="01"
          tile="red"
          title={t("sections.colour")}
          lead={t("colour.lead")}
        />
        <Sub title={t("colour.scales")}>
          <div className="space-y-4">
            {(Object.keys(SCALES) as (keyof typeof SCALES)[]).map((hue) => (
              <div
                key={hue}
                className="grid gap-2 sm:grid-cols-[8rem_minmax(0,1fr)] sm:items-center"
              >
                <p className="text-sm font-semibold text-ink">
                  {t(`colour.hues.${hue}`)}
                </p>
                <ul className="grid grid-cols-6 gap-1.5 sm:grid-cols-11">
                  {SCALES[hue].map((swatch, i) => (
                    <li key={swatch} className="text-center">
                      <span
                        aria-hidden="true"
                        className={cn(
                          "block aspect-square rounded-[22%] ring-1 ring-black/5 dark:ring-white/10",
                          swatch
                        )}
                      />
                      <span className="mt-1 block text-xs text-ink-muted">
                        {STEPS[i]}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Sub>
        <Sub title={t("colour.semantic")}>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {ROLES.map(({ key, swatch }) => (
              <li
                key={key}
                className="flex items-center gap-3 rounded-2xl border-2 border-border bg-surface p-3"
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "size-10 shrink-0 rounded-[22%] ring-1 ring-border-strong",
                    swatch
                  )}
                />
                <span className="text-sm font-semibold text-ink">
                  {t(`colour.roles.${key}`)}
                </span>
              </li>
            ))}
          </ul>
        </Sub>
        <Sub title={t("colour.sections")}>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {SECTION_TINTS.map(({ key, bg, ink }) => (
              <li key={key} className={cn("rounded-3xl p-4", bg)}>
                <span className={cn("font-display text-h5 font-bold", ink)}>
                  {t(`colour.sectionNames.${key}`)}
                </span>
              </li>
            ))}
          </ul>
        </Sub>
      </Section>

      {/* Type */}
      <Section
        id="type"
        labelledBy="sg-type"
        width="wide"
        tone="tint"
        hue="green"
      >
        <SectionHeading
          id="sg-type"
          eyebrow="02"
          tile="green"
          title={t("sections.type")}
          lead={t("type.intro")}
        />
        <ul className="mt-10 divide-y-2 divide-border rounded-3xl border-2 border-border bg-surface">
          {TYPE.map(({ key, cls }) => (
            <li
              key={key}
              className="grid gap-2 p-5 sm:grid-cols-[13rem_minmax(0,1fr)] sm:items-baseline sm:gap-6 sm:p-6"
            >
              <p className="text-sm text-ink-muted">{t(`type.sizes.${key}`)}</p>
              <p className={cn("leading-tight text-ink", cls)}>
                {t(`type.${key}`)}
              </p>
            </li>
          ))}
        </ul>
      </Section>

      {/* Building blocks */}
      <Section id="primitives" labelledBy="sg-primitives" width="wide">
        <SectionHeading
          id="sg-primitives"
          eyebrow="03"
          tile="blue"
          title={t("sections.primitives")}
        />
        <Sub title={t("primitives.buttons")}>
          <div className="flex flex-wrap items-center gap-3">
            <ButtonLink href={ROUTES.competitions.path} size="lg">
              {t("primitives.primary")}
            </ButtonLink>
            <ButtonLink
              href={ROUTES.schools.path}
              variant="secondary"
              size="lg"
            >
              {t("primitives.secondary")}
            </ButtonLink>
            <ButtonLink href={ROUTES.impact.path} variant="quiet">
              {t("primitives.quiet")}
            </ButtonLink>
          </div>
        </Sub>
        <Sub title={t("primitives.chips")}>
          <div className="flex flex-wrap gap-2">
            <Chip tone="neutral">{t("colour.hues.neutral")}</Chip>
            <Chip tone="blue">{t("colour.hues.blue")}</Chip>
            <Chip tone="green">{t("colour.hues.green")}</Chip>
            <Chip tone="pink">{t("colour.hues.pink")}</Chip>
            <Chip tone="marigold">{t("colour.hues.yellow")}</Chip>
            <SampleTag />
          </div>
        </Sub>
        <Sub title={t("primitives.status")}>
          <div className="flex flex-wrap gap-2">
            {COMPETITION_STATUSES.filter((s) =>
              [
                "PUBLISHED",
                "REGISTRATION_OPEN",
                "IN_PROGRESS",
                "RESULTS_PUBLISHED",
                "CANCELLED",
              ].includes(s)
            ).map((s) => (
              <StatusChip key={s} status={s} />
            ))}
          </div>
        </Sub>
        <Sub title={t("primitives.tiles")}>
          <div className="flex flex-wrap items-center gap-3">
            {HUES.map((hue) => (
              <TileMarker key={hue} hue={hue} size="lg" />
            ))}
          </div>
          <TileDivider className="mt-6" />
        </Sub>
        <Sub title={t("primitives.callouts")}>
          <div className="grid gap-4 md:grid-cols-2">
            {(["info", "success", "warning", "danger"] as const).map((tone) => (
              <Callout key={tone} tone={tone}>
                <p>{t("primitives.calloutBody")}</p>
              </Callout>
            ))}
          </div>
        </Sub>
        <Sub title={t("primitives.calloutWithLink")}>
          {/* What staging and production show on the phone pages until
              DLT approval; here, axe checks it in every E2E run. */}
          <SmsOffCallout intent="sign-in" className="max-w-xl" />
          {/* What production's sign-in pages show until SES can send to
              anyone (DECISIONS R-27). */}
          <EmailOffCallout intent="sign-in" className="mt-4 max-w-xl" />
        </Sub>
        <Sub title={t("primitives.disclosure")}>
          <Disclosure
            summary={t("primitives.disclosureSummary")}
            className="max-w-2xl"
          >
            <p>{t("primitives.disclosureBody")}</p>
          </Disclosure>
        </Sub>
        <Sub title={t("primitives.placeholder")}>
          <WithOrgFacts>
            {(facts) => <Placeholder fact={facts.email} />}
          </WithOrgFacts>
        </Sub>
        <Sub title={t("primitives.headings")}>
          <SectionHeading
            eyebrow={t("primitives.headingEyebrow")}
            tile="teal"
            title={t("primitives.headingTitle")}
            lead={t("primitives.headingLead")}
          />
        </Sub>
      </Section>

      {/* Cards */}
      <Section
        id="cards"
        labelledBy="sg-cards"
        width="wide"
        tone="tint"
        hue="yellow"
      >
        <SectionHeading
          id="sg-cards"
          eyebrow="04"
          tile="yellow"
          title={t("sections.cards")}
        />
        <Sub title={t("cards.stories")}>
          <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {repoStoryCards().map((story) => (
              <li key={story.slug} className="flex">
                <StoryCard story={story} headingLevel={4} className="w-full" />
              </li>
            ))}
          </ul>
        </Sub>
        <Sub title={t("cards.competitions")}>
          <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {competitions.map((c) => (
              <li key={c.slug} className="flex">
                <CompetitionCard
                  competition={fromSample(c)}
                  headingLevel={4}
                  className="w-full"
                />
              </li>
            ))}
          </ul>
        </Sub>
        <Sub title={t("cards.seasonal")}>
          <SeasonalCard headingLevel={4} />
        </Sub>
        {impact ? (
          <Sub title={t("cards.counters")}>
            <ImpactCounters impact={impact} headingLevel={4} />
          </Sub>
        ) : null}
        <Sub title={t("cards.quote")}>
          <div className="grid gap-12 lg:grid-cols-2">
            <QuoteFigure id="Q32a" hue="red" />
            <QuoteFigure id="Q15b" size="md" hue="green" gloss />
          </div>
        </Sub>
      </Section>

      {/* Showcase */}
      <Section id="showcase" labelledBy="sg-showcase" width="wide">
        <SectionHeading
          id="sg-showcase"
          eyebrow="05"
          tile="teal"
          title={t("sections.showcase")}
        />
        <Sub title={t("showcase.doors")}>
          <TwoDoors id="sg-doors" headingLevel={4} />
        </Sub>
        <Sub title={t("showcase.judging")}>
          <JudgingPath headingLevel={4} />
        </Sub>
        <Sub title={t("showcase.judgingCompact")}>
          <JudgingPath compact headingLevel={4} />
        </Sub>
        <Sub title={t("showcase.certificate")}>
          <CertificatePreview headingLevel={4} />
        </Sub>
      </Section>

      {/* Dark */}
      <Section
        id="dark"
        labelledBy="sg-dark"
        width="wide"
        tone="tint"
        hue="pink"
      >
        <SectionHeading
          id="sg-dark"
          eyebrow="06"
          tile="pink"
          title={t("sections.dark")}
          lead={t("dark.lead")}
        />
        <div className="dark mt-10 rounded-3xl bg-background p-5 text-ink [--section-heading:var(--ink)] sm:p-8 lg:p-10">
          <div className="flex flex-wrap items-center gap-3">
            <ButtonLink href={ROUTES.competitions.path}>
              {t("primitives.primary")}
            </ButtonLink>
            <ButtonLink href={ROUTES.schools.path} variant="secondary">
              {t("primitives.secondary")}
            </ButtonLink>
            <StatusChip status="REGISTRATION_OPEN" />
            <StatusChip status="PUBLISHED" />
            <SampleTag />
          </div>
          <TileDivider className="my-10" />
          <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            <li className="flex">
              <StoryCard
                story={repoStoryCards()[1]!}
                headingLevel={3}
                className="w-full"
              />
            </li>
            {competitions.slice(0, 2).map((c) => (
              <li key={c.slug} className="flex">
                <CompetitionCard
                  competition={fromSample(c)}
                  headingLevel={3}
                  className="w-full"
                />
              </li>
            ))}
          </ul>
          <div className="mt-10 space-y-10">
            <SeasonalCard id="sg-dark-seasonal" headingLevel={3} />
            {impact ? (
              <ImpactCounters impact={impact} headingLevel={3} />
            ) : null}
            <QuoteFigure id="Q36" hue="yellow" />
            <TwoDoors id="sg-dark-doors" headingLevel={3} />
            <JudgingPath headingLevel={3} />
            <CertificatePreview headingLevel={3} />
          </div>
        </div>
      </Section>

      {/* Illustrations: every art component, so axe checks each one in
          every E2E run. */}
      <Section id="illustrations" labelledBy="sg-illustrations" width="wide">
        <SectionHeading
          id="sg-illustrations"
          eyebrow="07"
          tile="red"
          title={t("sections.illustrations")}
          lead={t("illustrations.lead")}
        />
        <Sub title={t("illustrations.illustration")}>
          <ul className="flex flex-wrap items-end gap-x-12 gap-y-8">
            <li>
              <Illustration
                id="chain-create"
                sizes="(min-width: 640px) 288px, 256px"
                className="w-64 sm:w-72"
              />
              <p className="mt-4 text-sm text-ink-muted">
                {t("illustrations.meaningful")}
              </p>
            </li>
            <li>
              <Illustration
                id="sticker-puppy"
                sizes="(min-width: 640px) 96px, 80px"
                decorative
                className="w-20 sm:w-24"
              />
              <p className="mt-4 text-sm text-ink-muted">
                {t("illustrations.decorative")}
              </p>
            </li>
            <li className="w-64 sm:w-80">
              <ArtFigure
                id="cover-stork"
                frame="blue"
                frameCorner="bottom-right"
                sizes="(min-width: 640px) 320px, 256px"
                className="aspect-4/3"
              />
              <p className="mt-4 text-sm text-ink-muted">
                {t("illustrations.figure")}
              </p>
            </li>
          </ul>
        </Sub>
        <Sub title={t("illustrations.living")}>
          <LivingIllustration
            id="living-sparrow"
            trigger="middle"
            decorative
            className="w-48 sm:w-56"
          />
          <p className="mt-4 max-w-prose text-sm text-ink-muted">
            {t("illustrations.livingNote")}
          </p>
        </Sub>
        <Sub title={t("illustrations.stickers")}>
          <div className="relative mt-8 max-w-xl rounded-3xl border-2 border-border bg-surface px-6 py-12 sm:px-10">
            <p className="mx-auto max-w-xs text-center text-sm text-ink-muted">
              {t("illustrations.stickersNote")}
            </p>
            <StickerScatter stickers={STICKERS} />
          </div>
        </Sub>
        <Sub title={t("illustrations.kolam")}>
          <KolamDivider />
        </Sub>
        <Sub title={t("illustrations.explain")}>
          <ExplainState
            title={t("illustrations.explainTitle")}
            art="wait-mailbox-cat"
            headingLevel="h3"
            className="max-w-2xl"
          >
            <p>{t("illustrations.explainBody")}</p>
          </ExplainState>
        </Sub>
        <Sub title={t("illustrations.mark")}>
          <AiMark />
          <p className="mt-4 max-w-prose text-sm text-ink-muted">
            {t("illustrations.markNote")}
          </p>
        </Sub>
      </Section>
      <Section
        id="viewer"
        labelledBy="sg-viewer"
        width="wide"
        hue="teal"
        tone="tint"
      >
        <SectionHeading
          id="sg-viewer"
          eyebrow="08"
          tile="teal"
          title={t("sections.viewer")}
        />
        <div className="mt-6 max-w-2xl rounded-3xl border-2 border-border bg-surface p-5">
          <NextIntlClientProvider
            locale={LOCALE}
            timeZone="Asia/Kolkata"
            messages={{ judgeScoring: messages.judgeScoring }}
          >
            <MediaViewer
              media={{
                kind: "image",
                url: siteArt("scene-street-neighbours").plain.src,
                width: null,
                height: null,
                thumbnailUrl: null,
              }}
              entryCode="SAMPLE"
            />
          </NextIntlClientProvider>
          <AiMark className="mt-3" />
        </div>
      </Section>
    </>
  );
}
