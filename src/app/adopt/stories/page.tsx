import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { ButtonLink } from "@/components/site/button-link";
import { PageHeader } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { ROUTES } from "@/lib/routes";
import { pageMetadata } from "@/lib/seo";

import { publishedStories } from "../_lib/public-reads";

// Adopters' success stories (#130), each shared with the adopter's
// consent: the animal, the organisation that listed it and the adopter's
// words, never their name. A static shell with the stories streamed in
// from a cached read that publishing or withdrawing a story refreshes.

const HUE = ROUTES.adoptionStories.hue;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adoptionApplications.stories.meta");
  return pageMetadata({
    title: t("title"),
    description: t("description"),
    path: ROUTES.adoptionStories.path,
  });
}

export default async function Page() {
  const t = await getTranslations("adoptionApplications.stories");
  return (
    <Section hue={HUE} tone="tint" width="prose" className="pt-10 sm:pt-14">
      <PageHeader
        eyebrow={t("eyebrow")}
        tile={HUE}
        title={t("title")}
        lead={t("lead")}
      />
      <Suspense
        fallback={<p className="mt-8 text-ink-muted">{t("loading")}</p>}
      >
        <Stories />
      </Suspense>
      <p className="mt-10">
        <ButtonLink href={ROUTES.adopt.path}>{t("browse")}</ButtonLink>
      </p>
    </Section>
  );
}

const CARD =
  "flex flex-col gap-3 rounded-3xl border-2 border-border bg-surface p-5 shadow-warm sm:p-6";

async function Stories() {
  const [t, species, format, stories] = await Promise.all([
    getTranslations("adoptionApplications.stories"),
    getTranslations("adoption.species"),
    getFormatter(),
    publishedStories(),
  ]);
  if (stories.length === 0) {
    return <p className="mt-8 text-ink">{t("empty")}</p>;
  }
  return (
    <ul className="mt-8 flex flex-col gap-6">
      {stories.map((story) => (
        <li key={story.id}>
          <article aria-labelledby={`story-${story.id}`} className={CARD}>
            <h2
              id={`story-${story.id}`}
              className="text-lead font-bold text-ink wrap-anywhere"
            >
              {t("storyOf", {
                name: story.animal.name,
                species: species(story.animal.species),
              })}
            </h2>
            <p className="text-ink whitespace-pre-line wrap-anywhere">
              {story.body}
            </p>
            <p className="text-sm text-ink-muted">
              {t("listedBy", { organisation: story.organisation.name })} ·{" "}
              <time dateTime={story.publishedAt.toISOString()}>
                {format.dateTime(story.publishedAt, "long")}
              </time>
            </p>
          </article>
        </li>
      ))}
    </ul>
  );
}
