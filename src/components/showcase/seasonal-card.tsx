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

/** Shows the current month in India. On /awareness, visitors can browse the year. */
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
  const format = await getFormatter();
  const months = SEASONAL_MONTHS.map((entry) => {
    const date = new Date(Date.UTC(2026, entry.month - 1, 15));
    return {
      entry,
      name: format.dateTime(date, { month: "long" }),
      initial: format.dateTime(date, { month: "narrow" }),
      titleId: `${id}-${entry.slug}`,
    };
  });
  const cardClass = cn(
    "grid grid-cols-1 gap-8 rounded-3xl border-2 border-border bg-surface p-6 shadow-warm [--section-heading:var(--section-teal-heading)] sm:p-8 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:gap-10",
    className
  );

  if (interactive) {
    const t = await getTranslations("showcase.seasonal");
    return (
      <SeasonalCalendar
        initialMonth={current.month}
        legend={t("monthPicker")}
        className={cardClass}
        months={months.map(({ entry, name, initial, titleId }) => ({
          number: entry.month,
          name,
          initial,
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
      <SeasonalCopy
        entry={current}
        headingLevel={headingLevel}
        monthName={name}
        titleId={titleId}
        isCurrentMonth
      />
      <div className="flex flex-col gap-6">
        {!current.imageId && (
          <div
            aria-hidden="true"
            className="@container/seasonal-month rounded-3xl bg-section-teal p-[min(1.5rem,8%)] sm:p-8"
          >
            <p className="font-display text-h2 leading-none font-bold wrap-anywhere text-(--section-heading)">
              {name}
            </p>
            <ol className="mt-6 grid grid-cols-3 gap-2 @min-[12rem]/seasonal-month:grid-cols-6">
              {months.map(({ entry, initial }) => (
                <li
                  key={entry.month}
                  className={cn(
                    "grid aspect-square place-items-center rounded-[22%] font-display text-sm font-bold",
                    entry.month === current.month
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
