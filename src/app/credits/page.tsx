import { ExternalLink } from "lucide-react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Image from "next/image";

import { PageHeader, SectionHeading } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { type TileHue, TileMarker } from "@/components/site/tile";
import { siteImage } from "@/lib/images";
import {
  type Credit,
  credits,
  LICENCE_LABEL,
  type SiteImageId,
} from "@/lib/images/credits";
import { ROUTES } from "@/lib/routes";
import { pageMetadata } from "@/lib/seo";

// next/image placeholder mode (a constant: the lint rule bars literals here).
const BLUR = "blur";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("credits.meta");
  return pageMetadata({
    title: t("title"),
    description: t("description"),
    path: ROUTES.credits.path,
  });
}

const GROUPS = [
  { key: "pages", hue: "blue" },
  { key: "neighbours", hue: "green" },
  { key: "seasons", hue: "teal" },
  { key: "stories", hue: "yellow" },
  { key: "happy", hue: "pink" },
] as const satisfies readonly { key: string; hue: TileHue }[];

const FONTS = [
  {
    key: "baloo",
    face: "font-display font-bold",
    url: "https://fonts.google.com/specimen/Baloo+2",
  },
  {
    key: "inter",
    face: "font-sans font-semibold",
    url: "https://fonts.google.com/specimen/Inter",
  },
  {
    key: "kalam",
    face: "font-hand",
    url: "https://fonts.google.com/specimen/Kalam",
  },
] as const;

const OFL = "https://openfontlicense.org/";
const LINK = "text-link underline underline-offset-2 hover:text-link-hover";

async function CreditCard({ credit }: { credit: Credit }) {
  const t = await getTranslations("credits");
  const { src, focal } = siteImage(credit.id as SiteImageId);
  return (
    <li className="@container/credit">
      <article className="grid h-full grid-cols-[minmax(0,1fr)] gap-x-4 gap-y-3 rounded-3xl border-2 border-border bg-surface p-4 @min-[18rem]/credit:grid-cols-[5rem_minmax(0,1fr)] @min-[32rem]/credit:grid-cols-[8rem_minmax(0,1fr)] @min-[32rem]/credit:grid-rows-[auto_1fr] @min-[32rem]/credit:gap-x-5 @min-[32rem]/credit:p-5">
        <Image
          src={src}
          alt={credit.alt}
          sizes="auto, 8rem"
          placeholder={BLUR}
          style={{ objectPosition: `${focal[0] * 100}% ${focal[1] * 100}%` }}
          className="aspect-square h-auto w-20 max-w-full rounded-2xl object-cover @min-[32rem]/credit:row-span-2 @min-[32rem]/credit:w-full"
        />
        <h3 className="self-center font-sans text-body leading-snug font-bold wrap-break-word text-ink @min-[32rem]/credit:self-start">
          {credit.title}
        </h3>
        <div className="min-w-0 @min-[18rem]/credit:col-span-2 @min-[32rem]/credit:col-span-1 @min-[32rem]/credit:col-start-2">
          <dl className="grid grid-cols-[fit-content(35%)_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm wrap-anywhere">
            <dt className="text-ink-muted">{t("fields.by")}</dt>
            <dd className="text-ink">
              {credit.authorUrl ? (
                <a href={credit.authorUrl} className={LINK}>
                  {credit.author}
                </a>
              ) : (
                credit.author
              )}
            </dd>
            <dt className="text-ink-muted">{t("fields.place")}</dt>
            <dd className="text-ink">{credit.place ?? t("noPlace")}</dd>
            <dt className="text-ink-muted">{t("fields.licence")}</dt>
            <dd>
              <a href={credit.licenceUrl} className={LINK}>
                {LICENCE_LABEL[credit.licence]}
              </a>
            </dd>
            <dt className="text-ink-muted">{t("fields.changes")}</dt>
            <dd className="text-ink">{credit.modifications}</dd>
            <dt className="text-ink-muted">{t("fields.why")}</dt>
            <dd className="text-ink">{credit.whyChosen}</dd>
          </dl>
          <a
            href={credit.sourceUrl}
            className="mt-2 inline-flex min-h-6 items-center gap-1.5 text-sm font-semibold text-link underline underline-offset-2 hover:text-link-hover"
          >
            {t("fields.source")}
            <ExternalLink aria-hidden="true" className="size-4" />
          </a>
        </div>
      </article>
    </li>
  );
}

export default async function Page() {
  const t = await getTranslations("credits");
  return (
    <>
      <Section
        hue="neutral"
        tone="tint"
        width="wide"
        className="py-14 sm:py-20"
      >
        <PageHeader
          eyebrow={t("eyebrow")}
          tile="yellow"
          title={t("title")}
          lead={t("lead")}
        />
        <p className="mt-6 max-w-prose text-ink-muted">{t("adaptations")}</p>
      </Section>

      {GROUPS.map(({ key, hue }) => {
        const list = credits.filter((c) => c.file.startsWith(`${key}/`));
        return (
          <Section
            key={key}
            labelledBy={`credits-${key}`}
            width="wide"
            className="py-12 sm:py-16"
          >
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <h2
                id={`credits-${key}`}
                className="flex min-w-0 items-center gap-3 text-h3 text-ink"
              >
                <TileMarker hue={hue} size="lg" />
                <span className="min-w-0 wrap-break-word">
                  {t(`groups.${key}`)}
                </span>
              </h2>
              <p className="text-ink-muted">
                {t("count", { count: list.length })}
              </p>
            </div>
            <ul className="mt-6 grid gap-4 md:grid-cols-2">
              {list.map((credit) => (
                <CreditCard key={credit.id} credit={credit} />
              ))}
            </ul>
          </Section>
        );
      })}

      <Section
        hue="neutral"
        tone="tint"
        labelledBy="credits-fonts"
        width="wide"
      >
        <SectionHeading
          id="credits-fonts"
          title={t("fonts.title")}
          lead={t("fonts.lead")}
        />
        <ul className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-3">
          {FONTS.map(({ key, face, url }) => (
            <li
              key={key}
              className="rounded-3xl border-2 border-border bg-surface p-5 wrap-break-word sm:p-6"
            >
              <p className={`text-h3 leading-tight text-ink ${face}`}>
                {t(`fonts.items.${key}.name`)}
              </p>
              <p className="mt-2 text-ink">
                {t("fields.by")} {t(`fonts.items.${key}.by`)}
              </p>
              <p className="mt-1 text-sm text-ink-muted">
                {t(`fonts.items.${key}.use`)}
              </p>
              <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                <a
                  href={OFL}
                  className={`inline-flex min-h-6 min-w-0 items-center ${LINK}`}
                >
                  {t("fonts.licence")}
                </a>
                <a
                  href={url}
                  className={`inline-flex min-h-6 min-w-0 items-center ${LINK}`}
                >
                  {t("fonts.specimen")}
                </a>
              </p>
            </li>
          ))}
        </ul>
        <p className="mt-8 max-w-prose text-sm text-ink-muted">{t("logo")}</p>
      </Section>
    </>
  );
}
