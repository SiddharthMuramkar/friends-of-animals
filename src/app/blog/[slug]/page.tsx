import { Clock } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";

import { ArtFigure } from "@/components/art/art-figure";
import { TileCover } from "@/components/showcase/card-cover";
import { PostPhoto } from "@/components/showcase/post-image";
import { StoryCard } from "@/components/showcase/story-card";
import { Chip } from "@/components/site/chip";
import { EasyRead } from "@/components/site/easy-read";
import { InPageLink } from "@/components/site/in-page-link";
import { JsonLd } from "@/components/site/json-ld";
import { Section } from "@/components/site/section";
import { SiteLink } from "@/components/site/site-link";
import { TileMarker } from "@/components/site/tile";
import { storyCoverArt } from "@/content/stories";
import { tableOfContents } from "@/content/stories/text";
import { siteUrl } from "@/env";
import { siteImage } from "@/lib/images";
import { ROUTES } from "@/lib/routes";
import { relatedPosts } from "@/server/modules/cms/domain/post-listing";
import {
  blogPostingJsonLd,
  postBreadcrumbJsonLd,
  postMetadata,
} from "@/server/modules/cms/domain/post-seo";
import {
  loadPublishedPost,
  loadPublishedPosts,
} from "@/server/modules/cms/posts/loaders";

import { ArticleBodyView, SourceList } from "./_components/article-body";
import styles from "./_components/article.module.css";
import { FactChecks } from "../_components/fact-checks";
import { ReadAloud } from "./_components/read-aloud";

const AUDIENCE_TONE = {
  kids: "green",
  families: "blue",
  everyone: "pink",
} as const;

const BODY_ID = "article-body";

// Every published post at build time. A build has no database, so these
// are the repo stories (never none); posts published later render on their
// first request, and the proxy 404s slugs that aren't public.
export async function generateStaticParams() {
  const posts = await loadPublishedPosts();
  return posts.map(({ slug }) => ({ slug }));
}

export async function generateMetadata({
  params,
}: PageProps<"/blog/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const post = await loadPublishedPost(slug);
  return post ? postMetadata(post) : {};
}

export default async function Page({ params }: PageProps<"/blog/[slug]">) {
  const { slug } = await params;
  const [post, posts] = await Promise.all([
    loadPublishedPost(slug),
    loadPublishedPosts(),
  ]);
  if (!post) notFound();
  const toc = tableOfContents(post.body.blocks);
  const coverArt = post.cover ? null : storyCoverArt(post.slug);

  const [t, tc, tr, format, locale] = await Promise.all([
    getTranslations("stories.article"),
    getTranslations("showcase.story"),
    getTranslations("stories.readAloud"),
    getFormatter(),
    getLocale(),
  ]);
  const published = format.dateTime(post.publishedAt, "long");

  const base = siteUrl();
  const jsonLd = [
    blogPostingJsonLd(post, base, {
      siteImageSrc:
        post.cover?.source === "site"
          ? siteImage(post.cover.id).src.src
          : undefined,
    }),
    postBreadcrumbJsonLd(post, base, {
      home: t("home"),
      index: t("allStories"),
    }),
  ];

  return (
    <>
      <div aria-hidden="true" className={styles.progress} />
      <JsonLd data={jsonLd} />
      <article>
        <Section
          hue="yellow"
          tone="tint"
          className="pt-8 pb-12 sm:pt-10 sm:pb-16"
        >
          <nav aria-label={t("breadcrumb")} className="text-sm">
            <ol className="flex flex-wrap items-center gap-x-2 text-ink-muted">
              <li>
                <SiteLink
                  href={ROUTES.stories.path}
                  className="inline-flex min-h-6 items-center font-semibold text-link underline underline-offset-2 hover:text-link-hover"
                >
                  {t("allStories")}
                </SiteLink>
              </li>
              <li aria-hidden="true">/</li>
              <li aria-current="page" className="line-clamp-1">
                {post.title}
              </li>
            </ol>
          </nav>
          <div className="mt-8 grid grid-cols-1 items-center gap-10 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
            <header>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <Chip tone={AUDIENCE_TONE[post.audience]}>
                  {tc(`audience.${post.audience}`)}
                </Chip>
                <span className="inline-flex items-center gap-1.5 text-sm text-ink-muted">
                  <Clock aria-hidden="true" className="size-4" />
                  {tc("minutes", { minutes: post.readingMinutes })}
                </span>
                <span className="text-sm text-ink-muted">
                  {t("published", { date: published })}
                </span>
                {post.authorName ? (
                  <span className="text-sm text-ink-muted">
                    {t("byline", { name: post.authorName })}
                  </span>
                ) : null}
              </div>
              <h1 className="mt-4 text-(--section-heading)">{post.title}</h1>
              <p className="mt-5 max-w-prose text-lead text-ink">
                {post.excerpt}
              </p>
              {post.easyRead ? (
                <EasyRead
                  label={t("easyReadLabel")}
                  className="mt-6 max-w-prose"
                >
                  <p>{post.easyRead}</p>
                </EasyRead>
              ) : null}
              {/* min-h-11 holds the player's row, which mounts after
                  hydration, so the story below doesn't jump. */}
              <div className="mt-6 min-h-11">
                <ReadAloud
                  targetId={BODY_ID}
                  locale={locale}
                  labels={{
                    listen: tr("listen"),
                    pause: tr("pause"),
                    resume: tr("resume"),
                    stop: tr("stop"),
                    onlineVoice: tr("onlineVoice"),
                    group: tr("group"),
                  }}
                />
              </div>
            </header>
            {post.cover ? (
              <PostPhoto
                image={post.cover}
                preload
                frame="blue"
                frameCorner="bottom-right"
                sizes="(min-width: 1024px) 520px, 92vw"
                className="aspect-4/3"
              />
            ) : coverArt ? (
              // On phones a half-width print, smaller than the dek, so text
              // stays the LCP element (see /blog). A 4/5-width cover still
              // won LCP on a 440x956 phone. It sits under the words there
              // (and on tablets), so it is preloaded only from lg, where it
              // stands beside the headline as the LCP image.
              <ArtFigure
                id={coverArt}
                preload="lg"
                frame="blue"
                frameCorner="bottom-right"
                sizes="(min-width: 1024px) 520px, (min-width: 640px) 92vw, 46vw"
                className="aspect-4/3"
                figureClassName="ml-auto mr-2 w-1/2 -rotate-2 sm:mx-0 sm:w-full sm:rotate-0"
              />
            ) : (
              <TileCover
                seed={post.slug}
                className="rounded-3xl border-2 border-yellow-700/20 bg-surface"
              />
            )}
          </div>
        </Section>

        <Section hue="yellow" className="pt-10 sm:pt-14">
          <div className="grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,1fr)_16rem] lg:gap-14">
            <nav
              aria-labelledby="toc"
              className="lg:sticky lg:top-[calc(var(--header-height)+1.5rem)] lg:order-2 lg:self-start"
            >
              <div className="rounded-3xl border-2 border-border bg-surface p-5">
                <p
                  id="toc"
                  className="flex items-center gap-2 font-display text-lead font-semibold"
                >
                  <TileMarker hue="yellow" size="sm" />
                  {t("toc")}
                </p>
                <ol className="mt-3 space-y-1 text-sm">
                  {toc.map((h) => (
                    <li key={h.id}>
                      <InPageLink
                        href={`#${h.id}`}
                        className="flex min-h-8 items-center rounded-lg px-2 text-ink hover:bg-surface-muted hover:text-link"
                      >
                        {h.text}
                      </InPageLink>
                    </li>
                  ))}
                  <li>
                    <InPageLink
                      href="#sources"
                      className="flex min-h-8 items-center rounded-lg px-2 text-ink-muted hover:bg-surface-muted hover:text-link"
                    >
                      {t("sources")}
                    </InPageLink>
                  </li>
                </ol>
              </div>
            </nav>
            <div className="min-w-0 lg:order-1">
              <ArticleBodyView body={post.body} id={BODY_ID} />
              <SourceList footnotes={post.body.footnotes} />
              <FactChecks className="mt-12" />
            </div>
          </div>
        </Section>
      </article>

      <Section hue="yellow" tone="tint" labelledBy="related">
        <h2 id="related" className="text-h2 text-(--section-heading)">
          {t("related")}
        </h2>
        <ul className="mt-8 grid grid-cols-1 gap-6 md:grid-cols-2">
          {relatedPosts(posts, post).map((s) => (
            <li key={s.slug} className="flex">
              <StoryCard story={s} className="w-full" />
            </li>
          ))}
        </ul>
        <SiteLink
          href={ROUTES.stories.path}
          className="mt-8 inline-flex min-h-11 items-center font-semibold text-link underline underline-offset-4 hover:text-link-hover"
        >
          {t("allStoriesLink")}
        </SiteLink>
      </Section>
    </>
  );
}
