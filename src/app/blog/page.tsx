import { ArrowRight, Clock } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { CardCover, TileCover } from "@/components/showcase/card-cover";
import { StoryCard } from "@/components/showcase/story-card";
import { Chip } from "@/components/site/chip";
import { PageHeader } from "@/components/site/heading";
import { Photo } from "@/components/site/photo";
import { EasyRead } from "@/components/site/easy-read";
import { Section } from "@/components/site/section";
import { STORIES, type Story, latestStories } from "@/content/stories";
import { ROUTES, slugHref } from "@/lib/routes";
import { pageMetadata } from "@/lib/seo";

import { FactChecks } from "./_components/fact-checks";

const AUDIENCE_TONE = {
  kids: "green",
  families: "blue",
  everyone: "pink",
} as const;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("stories.meta");
  return pageMetadata({
    title: t("title"),
    description: t("description"),
    path: ROUTES.stories.path,
  });
}

/** The featured story, wide: cover on one side, words on the other. */
async function FeaturedStory({ story }: { story: Story }) {
  const [t, tc] = await Promise.all([
    getTranslations("stories.index"),
    getTranslations("showcase.story"),
  ]);
  return (
    <article className="group relative grid overflow-hidden rounded-3xl border-2 border-border bg-surface shadow-warm transition-[translate,border-color] duration-200 ease-out hover:border-border-strong has-[a:focus-visible]:border-border-strong motion-safe:hover:-translate-y-0.5 md:grid-cols-2">
      {story.coverImageId ? (
        <CardCover
          id={story.coverImageId}
          sizes="(min-width: 768px) 560px, 92vw"
          className="md:aspect-auto md:min-h-80"
        />
      ) : (
        <TileCover seed={story.slug} className="md:aspect-auto md:min-h-80" />
      )}
      <div className="flex flex-col gap-4 p-6 sm:p-8">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Chip tone="marigold">{t("featured")}</Chip>
          <Chip tone={AUDIENCE_TONE[story.audience]}>
            {tc(`audience.${story.audience}`)}
          </Chip>
          <span className="inline-flex items-center gap-1.5 text-sm text-ink-muted">
            <Clock aria-hidden="true" className="size-4" />
            {tc("minutes", { minutes: story.readingMinutes })}
          </span>
        </div>
        <h3 className="text-h3 leading-tight text-ink">
          <Link
            href={slugHref("story", story.slug)}
            prefetch={true}
            className="rounded-sm decoration-2 underline-offset-4 group-hover:underline after:absolute after:inset-0 after:rounded-3xl after:content-['']"
          >
            {story.title}
          </Link>
        </h3>
        <p className="text-lead text-ink-muted">{story.dek}</p>
        <p
          aria-hidden="true"
          className="mt-auto inline-flex items-center gap-2 font-semibold text-link"
        >
          {t("readStory")}
          <ArrowRight className="size-5 transition-transform duration-200 motion-safe:group-hover:translate-x-1" />
        </p>
      </div>
    </article>
  );
}

export default async function Page() {
  const t = await getTranslations("stories.index");
  const [featured] = latestStories(1);
  const rest = STORIES.filter((s) => s.slug !== featured!.slug);

  return (
    <>
      <Section hue="yellow" tone="tint" className="pt-10 sm:pt-16">
        <div className="grid items-center gap-10 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:gap-16">
          <div>
            <PageHeader
              eyebrow={t("eyebrow")}
              tile="yellow"
              title={t("title")}
              lead={t("lead")}
            />
            <EasyRead label={t("easyReadLabel")} className="mt-6 max-w-prose">
              <p>{t("easyRead")}</p>
            </EasyRead>
          </div>
          <Photo
            id="hand-paw-friendship"
            preload
            frame="red"
            frameCorner="top-right"
            sizes="(min-width: 1024px) 480px, 92vw"
            className="aspect-4/3"
          />
        </div>
      </Section>

      <Section hue="yellow" labelledBy="featured">
        <h2 id="featured" className="sr-only">
          {t("featuredHeading")}
        </h2>
        <FeaturedStory story={featured!} />

        <h2 id="more" className="mt-16 text-h2 text-(--section-heading)">
          {t("more")}
        </h2>
        <ul className="mt-8 grid gap-6 md:grid-cols-2">
          {rest.map((s) => (
            <li key={s.slug} className="flex">
              <StoryCard story={s} className="w-full" />
            </li>
          ))}
        </ul>

        <FactChecks className="mt-16 max-w-3xl" />
      </Section>
    </>
  );
}
