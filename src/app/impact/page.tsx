import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { ImpactCounters } from "@/components/showcase/impact-counters";
import { QuoteFigure } from "@/components/showcase/quote-figure";
import { ExplainState } from "@/components/site/explain-state";
import { PageHeader, SectionHeading } from "@/components/site/heading";
import { Photo } from "@/components/site/photo";
import { SampleTag } from "@/components/site/sample-tag";
import { Section } from "@/components/site/section";
import { type TileHue, TileMarker } from "@/components/site/tile";
import { getSampleImpact } from "@/content/sample";
import { ROUTES } from "@/lib/routes";
import { pageMetadata } from "@/lib/seo";

import { EasyRead } from "../competitions/_components/easy-read";

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
  const impact = getSampleImpact();

  return (
    <>
      <Section hue={HUE} tone="tint" className="pt-10 sm:pt-14">
        <div className="grid items-center gap-10 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:gap-14">
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
          <Photo
            id="dogs-vests-mat-stall"
            sizes="(min-width: 1024px) 40vw, 92vw"
            preload
            frame="green"
            frameCorner="bottom-left"
            caption={t("hero.photoCaption")}
            className="aspect-4/3"
            figureClassName="mx-auto w-full max-w-lg"
          />
        </div>
        <QuoteFigure
          id="Q10b"
          hue="teal"
          size="md"
          className="mt-14 sm:mt-20"
        />
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
        <div className="mt-10 grid gap-10 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
          <div className="overflow-hidden rounded-3xl border-2 border-border bg-surface">
            <table className="w-full text-left">
              <caption className="sr-only">{t("method.caption")}</caption>
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
          </div>
          <div>
            <h3 className="text-h3">{t("method.rules.title")}</h3>
            <ol className="mt-5 grid gap-4">
              {RULES.map((k, i) => (
                <li key={k} className="flex items-start gap-3">
                  <span
                    aria-hidden="true"
                    className="grid size-8 shrink-0 place-items-center rounded-[22%] bg-section-teal font-display font-bold text-section-teal-heading"
                  >
                    {i + 1}
                  </span>
                  <span className="pt-0.5">{t(`method.rules.${k}`)}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </Section>

      <Section hue={HUE} tone="tint">
        {impact ? (
          <>
            <p className="mb-6 flex flex-wrap items-center gap-2 text-sm text-ink-muted">
              <SampleTag />
              {t("counters.sampleNote")}
            </p>
            <ImpactCounters impact={impact} />
          </>
        ) : (
          <ExplainState title={t("counters.empty.title")} className="max-w-2xl">
            <p>{t("counters.empty.body")}</p>
          </ExplainState>
        )}
      </Section>

      <Section labelledBy="publish-title" hue={HUE}>
        <SectionHeading id="publish-title" title={t("publish.title")} />
        <ul className="mt-8 grid gap-5 sm:grid-cols-2">
          {PUBLISH.map(({ key, hue }) => (
            <li
              key={key}
              className="flex items-start gap-4 rounded-3xl bg-surface p-6 shadow-warm"
            >
              <TileMarker hue={hue} size="lg" />
              <span className="text-lead">{t(`publish.items.${key}`)}</span>
            </li>
          ))}
        </ul>
        <p className="mt-6 text-ink-muted">{t("publish.transparency")}</p>
      </Section>
    </>
  );
}
