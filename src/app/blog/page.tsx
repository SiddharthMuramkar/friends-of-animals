import { ArrowRight, Clock } from "lucide-react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { PendingDot } from "@/components/nav-link";
import { SiteLink } from "@/components/site/site-link";
import { PostCover } from "@/components/showcase/post-image";
import { StoryCard } from "@/components/showcase/story-card";
import { Chip } from "@/components/site/chip";
import { PageHeader } from "@/components/site/heading";
import { Photo } from "@/components/site/photo";
import { EasyRead } from "@/components/site/easy-read";
import { Section } from "@/components/site/section";
import { ROUTES, slugHref } from "@/lib/routes";
import { pageMetadata } from "@/lib/seo";
import { splitFeatured } from "@/server/modules/cms/domain/post-listing";
import type { PostCard } from "@/server/modules/cms/domain/post-view";
import { loadPublishedPosts } from "@/server/modules/cms/posts/loaders";

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
async function FeaturedStory({ story }: { story: PostCard }) {
  const [t, tc] = await Promise.all([
    getTranslations("stories.index"),
    getTranslations("showcase.story"),
  ]);
  return (
    <article className="group relative grid grid-cols-1 overflow-hidden rounded-3xl border-2 border-border bg-surface shadow-warm transition-[translate,border-color] duration-200 ease-out hover:border-border-strong has-[a:focus-visible]:border-border-strong motion-safe:hover:-translate-y-0.5 md:grid-cols-2">
      <PostCover
        image={story.cover}
        seed={story.slug}
        sizes="(min-width: 768px) 560px, 92vw"
        className="md:aspect-auto md:min-h-80"
      />
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
          <SiteLink
            href={slugHref("story", story.slug)}
            prefetch={true}
            className="rounded-sm decoration-2 underline-offset-4 group-hover:underline after:absolute after:inset-0 after:rounded-3xl after:content-[''] active:after:bg-ink/8"
          >
            {story.title}
            <PendingDot className="ms-2 inline-block align-middle" />
          </SiteLink>
        </h3>
        <p className="text-lead text-ink-muted">{story.excerpt}</p>
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
  const [t, posts] = await Promise.all([
    getTranslations("stories.index"),
    loadPublishedPosts(),
  ]);
  const { lead, rest } = splitFeatured(posts);

  return (
    <>
      <Section hue="yellow" tone="tint" className="pt-10 sm:pt-16">
        <div className="grid grid-cols-[minmax(0,1fr)] items-center gap-10 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:gap-16">
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
          {/* On phones a half-width print, smaller than the lead text, so
              text stays the LCP element (see /about and /contact). */}
          <Photo
            id="hand-paw-friendship"
            preload
            frame="red"
            frameCorner="top-right"
            sizes="(min-width: 1024px) 480px, (min-width: 640px) min(92vw, 512px), 46vw"
            className="aspect-4/3"
            figureClassName="ml-auto mr-2 w-1/2 -rotate-2 sm:mx-auto sm:w-full sm:max-w-lg sm:rotate-0 lg:max-w-none"
          />
        </div>
      </Section>

      <Section hue="yellow" labelledBy="featured">
        <h2 id="featured" className="sr-only">
          {t("featuredHeading")}
        </h2>
        {lead ? (
          <FeaturedStory story={lead} />
        ) : (
          <p className="max-w-prose text-lead text-ink-muted">{t("empty")}</p>
        )}

        {rest.length > 0 ? (
          <>
            <h2 id="more" className="mt-16 text-h2 text-(--section-heading)">
              {t("more")}
            </h2>
            <ul className="mt-8 grid grid-cols-1 gap-6 md:grid-cols-2">
              {rest.map((s) => (
                <li key={s.slug} className="flex">
                  <StoryCard story={s} className="w-full" />
                </li>
              ))}
            </ul>
          </>
        ) : null}

        <FactChecks className="mt-16 max-w-3xl" />
      </Section>
    </>
  );
}
