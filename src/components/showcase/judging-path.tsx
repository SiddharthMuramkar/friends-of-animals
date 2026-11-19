import {
  Building2,
  EyeOff,
  Flag,
  Globe2,
  type LucideIcon,
  Map as MapIcon,
  School,
} from "lucide-react";
import { getTranslations } from "next-intl/server";

import { type JudgingLevel, JUDGING_LEVELS, RUBRIC } from "@/content/judging";
import { cn } from "@/lib/utils";

import { H, type HeadingLevel, sub } from "./heading";

const ICON: Record<JudgingLevel, LucideIcon> = {
  SCHOOL: School,
  CITY: Building2,
  STATE: MapIcon,
  NATIONAL: Flag,
  GLOBAL: Globe2,
};
const ACTIVE_TILE: Partial<Record<JudgingLevel, string>> = {
  SCHOOL: "bg-green-700 text-white",
  NATIONAL: "bg-blue-700 text-white",
};
const BAR = ["bg-red-600", "bg-yellow-400", "bg-teal-500", "bg-pink-500"];
const MAX = Math.max(...RUBRIC.map((r) => r.weight));

/**
 * "Judging path, honestly lit": the five levels, with the ones not open
 * yet marked "Later"; the rubric weights; and the blind-judging promise.
 */
export async function JudgingPath({
  compact = false,
  headingLevel = 2,
  className,
}: {
  /** Path and promise only (home page). */
  compact?: boolean;
  headingLevel?: HeadingLevel;
  className?: string;
}) {
  const t = await getTranslations("showcase.judging");
  return (
    <div className={className}>
      <H level={headingLevel} className="text-(--section-heading,var(--ink))">
        {t("title")}
      </H>
      {compact ? null : (
        <p className="mt-4 max-w-prose text-lead text-ink-muted">{t("lead")}</p>
      )}

      <ol
        aria-label={t("pathLabel")}
        className="relative mt-8 grid gap-5 sm:grid-cols-5 sm:gap-3"
      >
        {/* The road: vertical on phones, horizontal from sm. */}
        <span
          aria-hidden="true"
          className="absolute top-7 bottom-7 left-7 w-0.5 bg-border-strong sm:top-7 sm:right-[10%] sm:bottom-auto sm:left-[10%] sm:h-0.5 sm:w-auto"
        />
        {JUDGING_LEVELS.map(({ key, active }) => {
          const Icon = ICON[key];
          return (
            <li
              key={key}
              className="relative flex items-start gap-4 sm:flex-col sm:items-center sm:text-center"
            >
              <span
                aria-hidden="true"
                className={cn(
                  "relative grid size-14 shrink-0 place-items-center rounded-[22%] [&_svg]:size-7",
                  active
                    ? cn(ACTIVE_TILE[key], "shadow-warm")
                    : "border-2 border-dashed border-border-strong bg-background text-ink-muted"
                )}
              >
                <Icon />
              </span>
              <span className="flex flex-col gap-1 sm:items-center">
                <span className="font-display text-h5 leading-tight font-bold text-ink">
                  {t(`levels.${key}`)}
                </span>
                <span
                  className={cn(
                    "w-fit rounded-full px-2.5 py-0.5 text-sm font-semibold",
                    active
                      ? "border border-success-border bg-success-bg text-ink"
                      : "border border-border-strong text-ink-muted"
                  )}
                >
                  {active ? t("active") : t("later")}
                </span>
                {active && !compact ? (
                  <span className="text-sm text-ink-muted">
                    {t(`levelNotes.${key as "SCHOOL" | "NATIONAL"}`)}
                  </span>
                ) : null}
              </span>
            </li>
          );
        })}
      </ol>

      {compact ? null : (
        <div className="mt-10">
          <H
            level={sub(headingLevel)}
            className="font-sans text-h5 font-bold text-ink"
          >
            {t("rubricTitle")}
          </H>
          <ul aria-label={t("rubricLabel")} className="mt-4 space-y-4">
            {RUBRIC.map(({ key, weight }, i) => (
              <li key={key}>
                <div className="flex items-baseline justify-between gap-4">
                  <span className="text-ink">{t(`rubric.${key}`)}</span>
                  <span className="font-display text-h5 font-bold text-ink">
                    {t("percent", { value: weight })}
                  </span>
                </div>
                <span
                  aria-hidden="true"
                  className="mt-1.5 block h-3 overflow-hidden rounded-full bg-surface-muted"
                >
                  <span
                    className={cn("block h-full rounded-full", BAR[i])}
                    style={{ width: `${(weight / MAX) * 100}%` }}
                  />
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="mt-8 flex items-start gap-3 rounded-2xl border-2 border-border bg-surface p-4 font-semibold text-ink sm:p-5">
        <EyeOff aria-hidden="true" className="mt-0.5 size-6 shrink-0" />
        {t("blind")}
      </p>
    </div>
  );
}
