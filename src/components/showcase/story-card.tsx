import { Clock } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { PendingDot } from "@/components/nav-link";
import { SiteLink } from "@/components/site/site-link";
import { Chip } from "@/components/site/chip";
import type { Story } from "@/content/stories";
import { slugHref } from "@/lib/routes";
import { cn } from "@/lib/utils";

import { CardCover, CardCredit, TileCover } from "./card-cover";
import { H, type HeadingLevel } from "./heading";

const AUDIENCE_TONE = {
  kids: "green",
  families: "blue",
  everyone: "pink",
} as const;

/** A story teaser: cover, audience, title, dek and reading time. */
export async function StoryCard({
  story,
  headingLevel = 3,
  sizes = "(min-width: 1024px) 380px, (min-width: 640px) 45vw, 92vw",
  className,
}: {
  story: Story;
  headingLevel?: HeadingLevel;
  sizes?: string;
  className?: string;
}) {
  const t = await getTranslations("showcase.story");
  return (
    <article
      className={cn(
        "group relative flex flex-col overflow-hidden rounded-3xl border-2 border-border bg-surface shadow-warm transition-[translate,border-color] duration-200 ease-out hover:border-border-strong motion-safe:hover:-translate-y-0.5 has-[a:focus-visible]:border-border-strong",
        className
      )}
    >
      {story.coverImageId ? (
        <CardCover id={story.coverImageId} sizes={sizes} />
      ) : (
        <TileCover seed={story.slug} />
      )}
      <div className="flex flex-1 flex-col gap-3 p-5 sm:p-6">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Chip tone={AUDIENCE_TONE[story.audience]}>
            {t(`audience.${story.audience}`)}
          </Chip>
          <span className="inline-flex items-center gap-1.5 text-sm text-ink-muted">
            <Clock aria-hidden="true" className="size-4" />
            {t("minutes", { minutes: story.readingMinutes })}
          </span>
        </div>
        <H level={headingLevel} className="text-h4 leading-tight text-ink">
          {/* Prefetch the full article: partialPrefetching would otherwise
              fetch only the shell (brief 02 item 9). */}
          <SiteLink
            href={slugHref("story", story.slug)}
            prefetch={true}
            className="rounded-sm decoration-2 underline-offset-4 group-hover:underline after:absolute after:inset-0 after:rounded-3xl after:content-[''] active:after:bg-ink/8"
          >
            {story.title}
            <PendingDot className="ms-2 inline-block align-middle" />
          </SiteLink>
        </H>
        <p className="text-ink-muted">{story.dek}</p>
        {story.coverImageId ? (
          <CardCredit id={story.coverImageId} className="mt-auto pt-2" />
        ) : null}
      </div>
    </article>
  );
}
