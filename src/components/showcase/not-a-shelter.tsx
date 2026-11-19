import { getTranslations } from "next-intl/server";

import { Chip } from "@/components/site/chip";
import { cn } from "@/lib/utils";

import { H, type HeadingLevel } from "./heading";

// FoA.md stakeholder framework §5 (welfare) and §6 (adoption). Grid cells on
// wide screens, in reading order around the centre.
const NODES = [
  {
    key: "shelters",
    cell: "md:col-start-1 md:row-start-1",
    tile: "bg-red-600",
  },
  {
    key: "rescuers",
    cell: "md:col-start-3 md:row-start-1",
    tile: "bg-blue-700",
  },
  {
    key: "adopters",
    cell: "md:col-start-1 md:row-start-2",
    tile: "bg-yellow-300",
  },
  {
    key: "volunteers",
    cell: "md:col-start-3 md:row-start-2",
    tile: "bg-pink-400",
  },
  {
    key: "fosters",
    cell: "md:col-start-1 md:row-start-3",
    tile: "bg-teal-400",
  },
  { key: "vets", cell: "md:col-start-3 md:row-start-3", tile: "bg-green-500" },
] as const;

// Centre (50 50) to each outer cell's centre, in a 100×100 box.
const LINES = [
  [17, 17],
  [83, 17],
  [17, 50],
  [83, 50],
  [17, 83],
  [83, 83],
] as const;

/**
 * W12 "We're not a shelter": FOA links people and groups who already care for
 * animals; every link is labelled "coming later" (adoption and the network are
 * M7). Connectors are decorative SVG; the list carries the meaning.
 */
export async function NotAShelter({
  headingLevel = 3,
  className,
}: {
  headingLevel?: HeadingLevel;
  className?: string;
}) {
  const t = await getTranslations("about.shelter");
  return (
    <div className={cn("relative", className)}>
      <svg
        aria-hidden="true"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className="pointer-events-none absolute inset-0 hidden size-full text-border-strong md:block"
      >
        {LINES.map(([x, y]) => (
          <line
            key={`${x}-${y}`}
            x1="50"
            y1="50"
            x2={x}
            y2={y}
            stroke="currentColor"
            strokeWidth="2"
            strokeDasharray="6 6"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>
      <div className="relative grid gap-4 md:grid-cols-3 md:grid-rows-3 md:gap-x-16 md:gap-y-10">
        <div className="rounded-3xl border-2 border-ink bg-surface p-5 text-center shadow-warm md:col-start-2 md:row-start-2 md:self-center">
          <div aria-hidden="true" className="flex justify-center gap-1.5">
            <span className="size-4 rounded-[22%] bg-red-600" />
            <span className="size-4 rounded-[22%] bg-green-500" />
            <span className="size-4 rounded-[22%] bg-blue-700" />
          </div>
          <H
            level={headingLevel}
            className="mt-3 font-display text-h4 text-ink"
          >
            {t("centre")}
          </H>
          <p className="mt-1 text-sm text-ink-muted">{t("centreNote")}</p>
        </div>
        <ul className="contents">
          {NODES.map(({ key, cell, tile }) => (
            <li
              key={key}
              className={cn(
                "flex items-start gap-3 rounded-3xl border-2 border-dashed border-border-strong bg-surface p-4",
                cell
              )}
            >
              <span
                aria-hidden="true"
                className={cn("mt-1 size-5 shrink-0 rounded-[22%]", tile)}
              />
              <span className="flex flex-col items-start gap-1.5">
                <span className="font-semibold text-ink">
                  {t(`nodes.${key}`)}
                </span>
                <Chip tone="neutral">{t("later")}</Chip>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
