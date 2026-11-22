import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { ImpactCounters } from "@/components/showcase/impact-counters";
import { QuoteFigure } from "@/components/showcase/quote-figure";
import { ExplainState } from "@/components/site/explain-state";
import { PageHeader, SectionHeading } from "@/components/site/heading";
import { Photo } from "@/components/site/photo";
import { SampleTag } from "@/components/site/sample-tag";
import { Section } from "@/components/site/section";
import { TableScroller } from "@/components/site/table-scroller";
import { type TileHue, TileMarker } from "@/components/site/tile";
import { ROUTES } from "@/lib/routes";
import { pageMetadata } from "@/lib/seo";
import { isSampleContentEnabled } from "@/lib/site";
import { Live } from "@/components/site/live";
import { loadImpact, seedImpact } from "@/server/modules/cms/site-pages";

import { EasyRead } from "@/components/site/easy-read";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("impact.meta");
  return pageMetadata({
    title: t("title"),
    description: t("description"),
    path: ROUTES.impact.path,
  });
}

const HUE = ROUTES.impact.hue;
const DEFS = [
  "participants",
  "institutions",
  "competitions",
  "statesReached",
  "artworksShowcased",
  "certificatesIssued",
  "funds",
] as const;
const RULES = ["small", "round", "offline", "asOf", "targets"] as const;
const PUBLISH = [
  { key: "counters", hue: "teal" },
  { key: "results", hue: "pink" },
  { key: "money", hue: "red" },
  { key: "method", hue: "blue" },
] as const satisfies readonly { key: string; hue: TileHue }[];

export default async function Page() {
  const t = await getTranslations("impact");
  const tc = await getTranslations("competitions");
  const sample = isSampleContentEnabled();

  return (
    <>
      <Section hue={HUE} tone="tint" className="pt-10 sm:pt-14">
        {/* Text, quote, then photo: on phones the photo sits below the first
            screen, so the heading text stays the LCP element (a hero image
            there would make Lighthouse count every script before it). From
            lg the photo takes the right column and the quote spans below. */}
        <div className="grid grid-cols-[minmax(0,1fr)] items-center gap-10 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:gap-14">
          <div>
            <PageHeader
              eyebrow={t("hero.eyebrow")}
              tile="teal"
              title={t("hero.title")}
              lead={t("hero.lead")}
            />
            <EasyRead
              label={tc("easyRead")}
              tile="teal"
              className="mt-8 max-w-xl"
            >
              <p>{t("hero.easy")}</p>
            </EasyRead>
          </div>
          <QuoteFigure
            id="Q10b"
            hue="teal"
            size="md"
            className="mt-4 sm:mt-10 lg:col-span-2 lg:mt-6"
          />
          <Photo
            id="dogs-lalbagh-play"
            sizes="(min-width: 1024px) min(40vw, 512px), min(92vw, 512px)"
            preload
            frame="green"
            frameCorner="bottom-left"
            caption={t("hero.photoCaption")}
            className="aspect-4/3"
            figureClassName="mx-auto w-full max-w-lg lg:col-start-2 lg:row-start-1"
          />
        </div>
      </Section>

      <Section
        id="how-we-count"
        labelledBy="method-title"
        hue={HUE}
        className="scroll-mt-20"
      >
        <SectionHeading
          id="method-title"
          title={t("method.title")}
          lead={t("method.lead")}
        />
        <div className="mt-10 grid grid-cols-[minmax(0,1fr)] gap-10 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
          <TableScroller captionId="method-caption">
            <table className="w-full text-left">
              <caption id="method-caption" className="sr-only">
                {t("method.caption")}
              </caption>
              <thead className="bg-surface-muted text-sm">
                <tr>
                  <th scope="col" className="px-5 py-3">
                    {t("method.number")}
                  </th>
                  <th scope="col" className="px-5 py-3">
                    {t("method.means")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {DEFS.map((k) => (
                  <tr key={k} className="border-t border-border align-top">
                    <th scope="row" className="px-5 py-3 font-semibold">
                      {t(`method.defs.${k}.name`)}
                    </th>
                    <td className="px-5 py-3 text-ink-muted">
                      {t(`method.defs.${k}.def`)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroller>
          <div>
            <h3 className="text-h3">{t("method.rules.title")}</h3>
            <ol className="mt-5 grid grid-cols-1 gap-4">
              {RULES.map((k, i) => (
                <li key={k} className="flex items-start gap-3">
                  <span
                    aria-hidden="true"
                    className="grid size-8 shrink-0 place-items-center rounded-[22%] bg-section-teal font-display font-bold text-section-teal-heading"
                  >
                    {i + 1}
                  </span>
                  <span className="min-w-0 pt-0.5">
                    {t(`method.rules.${k}`)}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </Section>

      <Section hue={HUE} tone="tint">
        {/* The published counters, read at request time. */}
        <Live fallback={seedImpact()} load={loadImpact}>
          {(impact) =>
            impact?.counters.length ? (
              <>
                {sample ? (
                  <p className="mb-6 flex flex-wrap items-center gap-2 text-sm text-ink-muted">
                    <SampleTag />
                    {t("counters.sampleNote")}
                  </p>
                ) : null}
                <ImpactCounters impact={impact} sample={sample} />
              </>
            ) : (
              <ExplainState
                title={t("counters.empty.title")}
                className="max-w-2xl"
              >
                <p>{t("counters.empty.body")}</p>
              </ExplainState>
            )
          }
        </Live>
      </Section>

      <Section labelledBy="publish-title" hue={HUE}>
        <SectionHeading id="publish-title" title={t("publish.title")} />
        <ul className="mt-8 grid grid-cols-1 gap-5 sm:grid-cols-2">
          {PUBLISH.map(({ key, hue }) => (
            <li
              key={key}
              className="flex items-start gap-4 rounded-3xl bg-surface p-6 shadow-warm"
            >
              <TileMarker hue={hue} size="lg" />
              <span className="min-w-0 text-lead">
                {t(`publish.items.${key}`)}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-6 text-ink-muted">{t("publish.transparency")}</p>
      </Section>
    </>
  );
}
