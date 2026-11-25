import { Check } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";

import { Illustration } from "@/components/art/illustration";
import { Disclosure } from "@/components/site/disclosure";
import { Eyebrow } from "@/components/site/heading";
import { Photo } from "@/components/site/photo";
import {
  SEASONAL_MONTHS,
  SEASONAL_SOURCES,
  seasonalGuideFor,
  type SeasonalMonth,
} from "@/content/awareness/seasonal";
import type { QuoteId } from "@/content/quotes";
import { cn } from "@/lib/utils";

import { cachedNow } from "./clock";
import { H, type HeadingLevel, sub } from "./heading";
import { QuoteFigure } from "./quote-figure";
import { SeasonalCalendar } from "./seasonal-calendar";

// Size the month grid against the panel itself, not the page: from six
// columns on wide cards to two on the narrowest phones. Each tile is at
// least 48px tall and remains a useful target when text is enlarged.
const MONTH_GRID =
  "grid min-w-0 grid-cols-2 gap-2 @min-[10rem]/seasonal-month:grid-cols-3 @min-[13.5rem]/seasonal-month:grid-cols-4 @min-[20.5rem]/seasonal-month:grid-cols-6";
const MONTH_TILE =
  "relative grid aspect-square min-h-12 max-h-16 min-w-0 place-items-center rounded-[22%] px-1 pt-2 pb-1 font-display text-sm leading-tight font-bold";
const MONTH_PANEL =
  "@container/seasonal-month min-w-0 rounded-3xl bg-section-teal p-[min(1.5rem,8%)] sm:p-8 lg:col-start-2 lg:row-start-1";

/** Shows the current month in India. Interactive instances browse the year. */
export async function SeasonalCard({
  id = "seasonal",
  headingLevel = 2,
  interactive = false,
  className,
}: {
  id?: string;
  headingLevel?: HeadingLevel;
  interactive?: boolean;
  className?: string;
}) {
  const current = seasonalGuideFor(new Date(await cachedNow()));
  const [format, t] = await Promise.all([
    getFormatter(),
    getTranslations("showcase.seasonal"),
  ]);
  const months = SEASONAL_MONTHS.map((entry) => {
    const date = new Date(Date.UTC(2026, entry.month - 1, 15));
    return {
      entry,
      name: format.dateTime(date, { month: "long" }),
      shortName: format.dateTime(date, { month: "short" }),
      titleId: `${id}-${entry.slug}`,
    };
  });
  const cardClass = cn(
    "grid min-w-0 grid-cols-1 items-start gap-8 rounded-3xl border-2 border-border bg-surface p-6 shadow-warm [--section-heading:var(--section-teal-heading)] sm:p-8 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:grid-rows-[auto_1fr] lg:gap-10 lg:gap-y-6",
    className
  );

  if (interactive) {
    return (
      <SeasonalCalendar
        key={current.month}
        id={id}
        initialMonth={current.month}
        className={cardClass}
        panelClassName={MONTH_PANEL}
        picker={
          <fieldset className={cn("mt-4", MONTH_GRID)}>
            <legend className="mb-3 text-sm font-semibold text-(--section-heading)">
              {t("monthPicker")}
            </legend>
            {months.map(({ entry, name, shortName }) => (
              <label
                key={entry.month}
                title={name}
                className={cn(
                  MONTH_TILE,
                  "cursor-pointer bg-surface text-ink-muted hover:ring-2 hover:ring-teal-700 has-checked:bg-teal-700 has-checked:text-white has-checked:shadow-warm has-focus-visible:outline-3 has-focus-visible:outline-offset-2 has-focus-visible:outline-focus"
                )}
              >
                <input
                  name={`${id}-months`}
                  type="radio"
                  value={entry.month}
                  defaultChecked={entry.month === current.month}
                  autoComplete="off"
                  className="peer absolute inset-0 size-full cursor-pointer opacity-0"
                />
                <span className="sr-only">{name}</span>
                <span aria-hidden="true" className="max-w-full wrap-anywhere">
                  {shortName}
                </span>
                <Check
                  aria-hidden="true"
                  className="absolute top-1 right-1 hidden size-3 peer-checked:block"
                />
              </label>
            ))}
          </fieldset>
        }
        months={months.map(({ entry, name, titleId }) => ({
          name,
          title: entry.title,
          titleId,
          copy: (
            <SeasonalCopy
              entry={entry}
              headingLevel={headingLevel}
              monthName={name}
              titleId={titleId}
              isCurrentMonth={entry.month === current.month}
            />
          ),
          media: <SeasonalMedia entry={entry} />,
        }))}
      />
    );
  }

  const { name, titleId } = months[current.month - 1]!;
  return (
    <article aria-labelledby={titleId} className={cardClass}>
      <div aria-hidden="true" className={MONTH_PANEL}>
        <p className="font-display text-h2 leading-none font-bold wrap-anywhere text-(--section-heading)">
          {name}
        </p>
        <p className="mt-4 mb-3 text-sm font-semibold text-(--section-heading)">
          {t("calendarLabel")}
        </p>
        <ol className={MONTH_GRID}>
          {months.map(({ entry, shortName }) => (
            <li
              key={entry.month}
              className={cn(
                MONTH_TILE,
                entry.month === current.month
                  ? "bg-teal-700 text-white shadow-warm"
                  : "bg-surface text-ink-muted"
              )}
            >
              <span className="max-w-full wrap-anywhere">{shortName}</span>
              {entry.month === current.month ? (
                <Check className="absolute top-1 right-1 size-3" />
              ) : null}
            </li>
          ))}
        </ol>
      </div>
      <div className="min-w-0 lg:col-start-1 lg:row-span-2 lg:row-start-1">
        <SeasonalCopy
          entry={current}
          headingLevel={headingLevel}
          monthName={name}
          titleId={titleId}
          isCurrentMonth
        />
      </div>
      <div className="min-w-0 lg:col-start-2 lg:row-start-2">
        <SeasonalMedia entry={current} />
      </div>
    </article>
  );
}

async function SeasonalCopy({
  entry,
  headingLevel,
  monthName,
  titleId,
  isCurrentMonth,
}: {
  entry: SeasonalMonth;
  headingLevel: HeadingLevel;
  monthName: string;
  titleId: string;
  isCurrentMonth: boolean;
}) {
  const t = await getTranslations("showcase.seasonal");
  return (
    <div>
      <Eyebrow tile="teal">
        {isCurrentMonth
          ? `${t("eyebrow")} · ${monthName}`
          : t("browsingEyebrow", { month: monthName })}
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
  );
}

function SeasonalMedia({ entry }: { entry: SeasonalMonth }) {
  return (
    <div className="flex flex-col gap-8">
      {entry.artId && (
        <Illustration
          id={entry.artId}
          sizes="(min-width: 1024px) 320px, (min-width: 532px) 448px, calc(100vw - 5.25rem)"
          pop
          className="mx-auto w-full max-w-md lg:max-w-xs"
        />
      )}
      {entry.imageId && (
        <Photo
          id={entry.imageId}
          sizes="(min-width: 1024px) 420px, 92vw"
          frame="green"
          frameCorner="top-right"
          className="aspect-4/3"
        />
      )}
      {entry.quoteId && (
        <QuoteFigure id={entry.quoteId as QuoteId} size="md" hue="teal" />
      )}
    </div>
  );
}
