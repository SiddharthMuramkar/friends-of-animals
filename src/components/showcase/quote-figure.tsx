import { getTranslations } from "next-intl/server";

import type { TileHue } from "@/components/site/tile";
import { type QuoteId, quote } from "@/content/quotes";
import { cn } from "@/lib/utils";

// White marks on the dark tiles, ink on the light ones (never white on logo green).
const TILE: Record<TileHue, string> = {
  red: "bg-red-600 text-white",
  green: "bg-green-500 text-neutral-900",
  blue: "bg-blue-700 text-white",
  yellow: "bg-yellow-300 text-neutral-900",
  teal: "bg-teal-400 text-neutral-900",
  pink: "bg-pink-400 text-neutral-900",
};

const OPEN_QUOTE = "“";
const DASH = "— ";

const SIZE = {
  md: "text-h4 leading-snug",
  lg: "text-h3 leading-tight",
} as const;

/**
 * A verified quote: <figure><blockquote cite><figcaption>, exact wording,
 * attribution (author, work, year, locator, translator) and a link to the
 * source. Usage: <QuoteFigure id="Q32a" />. One per surface.
 */
export async function QuoteFigure({
  id,
  size = "lg",
  hue = "blue",
  gloss = false,
  original = false,
  className,
}: {
  id: QuoteId;
  size?: keyof typeof SIZE;
  hue?: TileHue;
  /** Show FOA's "In simple words" line, for kid-facing pages. */
  gloss?: boolean;
  /** Show the original-language text when there is one. */
  original?: boolean;
  className?: string;
}) {
  const t = await getTranslations("showcase.quote");
  const q = quote(id);
  const lines = (q.display ?? q.text).split(" / ");
  const authorLead = `${q.author}, `;

  return (
    <figure
      className={cn(
        "grid max-w-3xl grid-cols-[auto_minmax(0,1fr)] gap-x-4 sm:gap-x-6",
        className
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "grid size-11 place-items-center rounded-[22%] pt-3 font-display text-5xl leading-none font-bold sm:size-14 sm:text-6xl",
          TILE[hue]
        )}
      >
        {OPEN_QUOTE}
      </span>
      <div>
        <blockquote cite={q.sourceUrl} lang={q.lang}>
          <p className={cn("font-display font-semibold text-ink", SIZE[size])}>
            {lines.map((line, i) => (
              <span key={i} className="block">
                {line}
              </span>
            ))}
          </p>
        </blockquote>
        {original && q.original ? (
          <p className="mt-3 text-ink-muted">
            <span className="text-sm font-semibold">{t("original")}: </span>
            <span lang={q.original.lang}>{q.original.text}</span>
          </p>
        ) : null}
        <figcaption className="mt-4 text-sm leading-relaxed text-ink-muted">
          <span aria-hidden="true">{DASH}</span>
          <span lang={q.lang}>
            {authorLead}
            {q.workIsTitle ? <cite className="italic">{q.work}</cite> : q.work}
          </span>
          {q.year ? ` (${q.year})` : null}
          {q.locator ? `, ${q.locator}` : null}
          {q.translator
            ? `, ${t("translatedBy", { name: q.translator })}`
            : null}
          {q.sourceUrl ? (
            <>
              {" · "}
              <a
                href={q.sourceUrl}
                aria-label={t("sourceOf", { author: q.author })}
                className="text-link underline underline-offset-2 hover:text-link-hover"
              >
                {t("source")}
              </a>
            </>
          ) : null}
        </figcaption>
        {gloss && q.kidGloss ? (
          <p className="mt-4 flex flex-wrap items-baseline gap-x-3 text-ink">
            <span className="min-w-0 font-hand text-lead text-(--section-heading,var(--ink))">
              {t("inSimpleWords")}
            </span>
            <span className="min-w-0">{q.kidGloss}</span>
          </p>
        ) : null}
      </div>
    </figure>
  );
}
