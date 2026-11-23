import { getTranslations } from "next-intl/server";

import { Illustration } from "@/components/art/illustration";
import { Chip } from "@/components/site/chip";
import { TileMarker } from "@/components/site/tile";
import type { SiteArtId } from "@/lib/art";
import { cn } from "@/lib/utils";

import { H, type HeadingLevel } from "./heading";

const DOORS = ["school", "self"] as const;
type Door = (typeof DOORS)[number];
const STEPS = {
  school: ["1", "2", "3", "4"],
  self: ["1", "2", "3"],
} as const;

// Decorative: the door's title already says which way in it is.
const DOOR_ART: Record<Door, SiteArtId> = {
  school: "door-school",
  self: "door-home",
};

// Static class strings so Tailwind sees them. The checked radio (marked by
// .door-school / .door-self) lights its own path through :has(); no JS.
const DOOR_CARD: Record<Door, string> = {
  school:
    "has-[:checked]:border-green-700 has-[:checked]:bg-section-green dark:has-[:checked]:border-green-400",
  self: "has-[:checked]:border-blue-700 has-[:checked]:bg-section-blue dark:has-[:checked]:border-blue-400",
};
const PATH: Record<Door, string> = {
  school:
    "group-has-[.door-school:checked]/doors:border-solid group-has-[.door-school:checked]/doors:border-green-700 group-has-[.door-school:checked]/doors:bg-section-green dark:group-has-[.door-school:checked]/doors:border-green-400",
  self: "group-has-[.door-self:checked]/doors:border-solid group-has-[.door-self:checked]/doors:border-blue-700 group-has-[.door-self:checked]/doors:bg-section-blue dark:group-has-[.door-self:checked]/doors:border-blue-400",
};
const NUMBER: Record<Door, string> = {
  school:
    "group-has-[.door-school:checked]/doors:bg-green-700 group-has-[.door-school:checked]/doors:text-white",
  self: "group-has-[.door-self:checked]/doors:bg-blue-700 group-has-[.door-self:checked]/doors:text-white",
};

/**
 * "Two doors, one path": a radio pair (school recommended, on your own)
 * that lights the chosen route's steps; both routes then merge into the same
 * judging and certificate. CSS only.
 */
export async function TwoDoors({
  id = "doors",
  headingLevel = 2,
  className,
}: {
  /** Unique per page: names the radio group. */
  id?: string;
  headingLevel?: HeadingLevel;
  className?: string;
}) {
  const t = await getTranslations("showcase.twoDoors");
  return (
    <div className={cn("group/doors", className)}>
      <H level={headingLevel} className="text-(--section-heading,var(--ink))">
        {t("title")}
      </H>
      <p className="mt-4 max-w-prose text-lead text-ink-muted">{t("lead")}</p>

      <fieldset className="mt-8 grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
        <legend className="sr-only">{t("legend")}</legend>
        {DOORS.map((door) => (
          // A size container: its door picture sits beside the words on a
          // wide card and is left out of a narrow one.
          <div
            key={door}
            className={cn(
              "group/door @container relative flex gap-4 rounded-3xl border-2 border-border bg-surface p-5 transition-[border-color,background-color,translate,box-shadow] duration-200 ease-out hover:border-border-strong motion-safe:hover:-translate-y-0.5 has-[:checked]:shadow-warm sm:p-6",
              DOOR_CARD[door]
            )}
          >
            <input
              type="radio"
              id={`${id}-${door}`}
              name={`${id}-door`}
              value={door}
              defaultChecked={door === "school"}
              aria-describedby={`${id}-${door}-line ${id}-${door}-note`}
              className={cn(
                `door-${door}`,
                "relative z-10 mt-1.5 size-6 shrink-0 cursor-pointer accent-blue-700 dark:accent-blue-400"
              )}
            />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                {/* The label's ::after stretches over the card: click anywhere. */}
                <label
                  htmlFor={`${id}-${door}`}
                  className="min-w-0 cursor-pointer font-display text-h4 leading-tight font-bold text-ink after:absolute after:inset-0 after:rounded-3xl after:content-['']"
                >
                  {t(`doors.${door}.title`)}
                </label>
                {door === "school" ? (
                  <Chip tone="green">{t("recommended")}</Chip>
                ) : null}
              </div>
              <p id={`${id}-${door}-line`} className="mt-2 text-ink">
                {t(`doors.${door}.line`)}
              </p>
              <p
                id={`${id}-${door}-note`}
                className="mt-2 text-sm text-ink-muted"
              >
                {t(`doors.${door}.note`)}
              </p>
            </div>
            {/* Clicks pass through to the label. The chosen door lifts a
                little, where motion is allowed. Small enough that the
                school title and its chip share a line on a desktop card. */}
            <Illustration
              id={DOOR_ART[door]}
              sizes="72px"
              decorative
              className="pointer-events-none hidden self-end motion-safe:transition-transform motion-safe:duration-300 motion-safe:ease-out motion-safe:group-has-[:checked]/door:-translate-y-1 @sm:block"
              imgClassName="w-18"
            />
          </div>
        ))}
      </fieldset>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {DOORS.map((door) => (
          <div
            key={door}
            className={cn(
              "rounded-3xl border-2 border-dashed border-border-strong p-5 transition-[border-color,background-color] duration-300 ease-out sm:p-6",
              PATH[door]
            )}
          >
            <ol
              aria-label={t("pathLabel", { door: t(`doors.${door}.title`) })}
              className="space-y-4"
            >
              {STEPS[door].map((step: "1" | "2" | "3" | "4") => (
                <li key={step} className="flex gap-3">
                  <span
                    aria-hidden="true"
                    className={cn(
                      "grid size-8 shrink-0 place-items-center rounded-[22%] bg-surface-muted font-display font-bold text-ink transition-colors duration-300",
                      NUMBER[door]
                    )}
                  >
                    {step}
                  </span>
                  <span className="min-w-0 pt-1 text-ink">
                    {door === "school"
                      ? t(`steps.school.${step}`)
                      : t(`steps.self.${step as "1" | "2" | "3"}`)}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        ))}
      </div>

      {/* The two paths meet. */}
      <div
        aria-hidden="true"
        className="mx-auto hidden h-10 w-1/2 rounded-b-3xl border-x-2 border-b-2 border-border-strong sm:block"
      />
      <div
        aria-hidden="true"
        className="mx-auto h-8 w-0.5 bg-border-strong sm:h-6"
      />

      <div className="mx-auto max-w-2xl rounded-3xl border-2 border-ink bg-surface p-5 shadow-warm sm:p-6">
        <p className="text-center font-hand text-lead text-ink">{t("merge")}</p>
        <ul className="mt-3 space-y-3">
          {(["1", "2"] as const).map((step, i) => (
            <li key={step} className="flex gap-3">
              <TileMarker
                hue={i === 0 ? "red" : "blue"}
                size="lg"
                className="mt-0.5"
              />
              <span className="min-w-0 text-ink">{t(`together.${step}`)}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
