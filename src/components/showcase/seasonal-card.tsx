import { getFormatter, getTranslations } from "next-intl/server";

import { Disclosure } from "@/components/site/disclosure";
import { Eyebrow } from "@/components/site/heading";
import { Photo } from "@/components/site/photo";
import {
  SEASONAL_MONTHS,
  SEASONAL_SOURCES,
  seasonalGuideFor,
} from "@/content/awareness/seasonal";
import type { QuoteId } from "@/content/quotes";
import type { SiteImageId } from "@/lib/images";
import { cn } from "@/lib/utils";

import { cachedNow } from "./clock";
import { H, type HeadingLevel, sub } from "./heading";
import { QuoteFigure } from "./quote-figure";

/**
 * One month of the seasonal kindness guide. Without `month` it shows the
 * current month in India, picked on the server and cached for a day.
 */
export async function SeasonalCard({
  month,
  id,
  headingLevel = 2,
  className,
}: {
  /** 1–12; omit for this month. */
  month?: number;
  /** Unique id prefix when the card appears twice on a page. */
  id?: string;
  headingLevel?: HeadingLevel;
  className?: string;
}) {
  const entry =
    month === undefined
      ? seasonalGuideFor(new Date(await cachedNow()))
      : SEASONAL_MONTHS[month - 1]!;
  const t = await getTranslations("showcase.seasonal");
  const format = await getFormatter();
  const monthName = format.dateTime(
    new Date(Date.UTC(2026, entry.month - 1, 15)),
    { month: "long" }
  );
  const initials = SEASONAL_MONTHS.map((m) =>
    format.dateTime(new Date(Date.UTC(2026, m.month - 1, 15)), {
      month: "narrow",
    })
  );
  const titleId = `${id ?? "seasonal"}-${entry.slug}`;

  return (
    <article
      aria-labelledby={titleId}
      className={cn(
        "grid grid-cols-1 gap-8 rounded-3xl border-2 border-border bg-surface p-6 shadow-warm [--section-heading:var(--section-teal-heading)] sm:p-8 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:gap-10",
        className
      )}
    >
      <div>
        <Eyebrow tile="teal">
          {t("eyebrow")} · {monthName}
        </Eyebrow>
        <H
          level={headingLevel}
          id={titleId}
          className="mt-3 text-h3 text-(--section-heading)"
        >
          {entry.title}
        </H>
        <p className="mt-3 font-display text-lead leading-snug font-semibold text-ink">
          {entry.kid}
        </p>

        <H
          level={sub(headingLevel)}
          className="mt-6 font-sans text-h5 font-bold text-ink"
        >
          {t("tryThis")}
        </H>
        <ol className="mt-3 space-y-3">
          {entry.actions.map((action, i) => (
            <li key={i} className="flex gap-3">
              <span
                aria-hidden="true"
                className="grid size-8 shrink-0 place-items-center rounded-[22%] bg-teal-400 font-display font-bold text-neutral-900"
              >
                {i + 1}
              </span>
              <span className="min-w-0 pt-1 wrap-anywhere">{action}</span>
            </li>
          ))}
        </ol>

        <Disclosure summary={t("forGrownUps")} className="mt-6">
          <p>{entry.grownUps}</p>
          <p>
            <strong>{t("why")}:</strong> {entry.why}
          </p>
          <div>
            <p className="text-sm font-semibold">{t("sources")}</p>
            <ul className="mt-1 space-y-1 text-sm">
              {entry.sources.map((id) => (
                <li key={id}>
                  <a
                    href={SEASONAL_SOURCES[id].url}
                    className="inline-flex min-h-6 max-w-full items-center text-link wrap-anywhere underline underline-offset-2 hover:text-link-hover"
                  >
                    {SEASONAL_SOURCES[id].label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </Disclosure>
        <p className="mt-4 text-sm text-ink-muted">{t("safety")}</p>
      </div>

      <div className="flex flex-col gap-8">
        {entry.imageId ? (
          <Photo
            id={entry.imageId as SiteImageId}
            sizes="(min-width: 1024px) 420px, 92vw"
            frame="green"
            frameCorner="top-right"
            className="aspect-4/3"
          />
        ) : (
          // No photo this month: the year at a glance, this month lit.
          <div
            aria-hidden="true"
            className="@container/seasonal-month rounded-3xl bg-section-teal p-[min(1.5rem,8%)] sm:p-8"
          >
            <p className="font-display text-h2 leading-none font-bold wrap-anywhere text-(--section-heading)">
              {monthName}
            </p>
            <ol className="mt-6 grid grid-cols-3 gap-2 @min-[12rem]/seasonal-month:grid-cols-6">
              {initials.map((initial, i) => (
                <li
                  key={i}
                  className={cn(
                    "grid aspect-square place-items-center rounded-[22%] font-display text-sm font-bold",
                    i + 1 === entry.month
                      ? "bg-teal-700 text-white shadow-warm"
                      : "bg-surface text-ink-muted"
                  )}
                >
                  {initial}
                </li>
              ))}
            </ol>
          </div>
        )}
        {entry.quoteId ? (
          <QuoteFigure id={entry.quoteId as QuoteId} size="md" hue="teal" />
        ) : null}
      </div>
    </article>
  );
}
