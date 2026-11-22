import { getFormatter, getTranslations } from "next-intl/server";
import { SiteLink } from "@/components/site/site-link";

import { SampleTag } from "@/components/site/sample-tag";
import { type TileHue, TileMarker } from "@/components/site/tile";
import type { Impact } from "@/content/sample/model";
import { visibleCounters } from "@/content/sample/selectors";
import { ROUTES } from "@/lib/routes";
import { cn } from "@/lib/utils";

import { H, type HeadingLevel } from "./heading";

const HUES: TileHue[] = ["red", "green", "blue", "teal", "pink", "yellow"];
// One column per shown counter on wide screens (suppressed ones leave no gap).
const COLS = [
  "",
  "lg:grid-cols-1",
  "lg:grid-cols-2",
  "lg:grid-cols-3",
  "lg:grid-cols-4",
];

/**
 * Impact counters, with small counts suppressed (counterDisplay): final
 * numbers in the HTML (never counted up from zero), in Baloo 2. Sample
 * data only for now.
 */
export async function ImpactCounters({
  impact,
  headingLevel = 2,
  className,
}: {
  impact: Impact;
  headingLevel?: HeadingLevel;
  className?: string;
}) {
  const t = await getTranslations("showcase.counters");
  const format = await getFormatter();
  const shown = visibleCounters(impact.counters);

  return (
    <div
      className={cn(
        "rounded-3xl border-2 border-border bg-surface p-6 shadow-warm sm:p-8",
        className
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <H
          level={headingLevel}
          className="text-h3 text-(--section-heading,var(--ink))"
        >
          {t("title")}
        </H>
        <SampleTag />
      </div>
      <dl
        className={cn(
          "mt-6 grid grid-cols-1 gap-6 min-[420px]:grid-cols-2",
          COLS[Math.min(shown.length, 4)]
        )}
      >
        {shown.map(({ key, display }, i) => (
          <div
            key={key}
            className="flex flex-col-reverse justify-end gap-1 border-t-2 border-border pt-4"
          >
            <dt className="text-ink-muted">{t(`labels.${key}`)}</dt>
            <dd className="flex flex-wrap items-center gap-3 font-display text-h1 leading-none font-bold text-ink">
              <TileMarker hue={HUES[i % HUES.length]} size="lg" />
              <span className="min-w-0">{display}</span>
            </dd>
          </div>
        ))}
      </dl>
      <p className="mt-6 max-w-prose text-sm text-ink-muted">
        {t("asOf", {
          date: format.dateTime(
            new Date(`${impact.asOf}T12:00:00+05:30`),
            "long"
          ),
        })}{" "}
        <SiteLink
          href={ROUTES.impact.path}
          className="font-semibold text-link underline underline-offset-4 hover:text-link-hover"
        >
          {t("howWeCount")}
        </SiteLink>
      </p>
    </div>
  );
}
