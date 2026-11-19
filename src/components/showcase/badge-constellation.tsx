import {
  Award,
  HandHeart,
  Megaphone,
  Palette,
  Plus,
  School,
  Users,
} from "lucide-react";
import { getTranslations } from "next-intl/server";
import type { ComponentType, SVGProps } from "react";

import { Chip } from "@/components/site/chip";
import { cn } from "@/lib/utils";

import { H, type HeadingLevel, sub } from "./heading";

/** SPEC §9.7.1 EngagementMilestone, in enum order. */
const BADGES = [
  "participant",
  "schoolWinner",
  "finalist",
  "communityMember",
  "volunteer",
  "ambassador",
] as const;
type Badge = (typeof BADGES)[number];

// Modules that open later (M6): their badges can't be earned yet.
const LATER: ReadonlySet<Badge> = new Set([
  "communityMember",
  "volunteer",
  "ambassador",
]);

const LOOK: Record<
  Badge,
  { tile: string; Icon: ComponentType<SVGProps<SVGSVGElement>>; tilt: string }
> = {
  participant: {
    tile: "bg-blue-700 text-white",
    Icon: Palette,
    tilt: "-rotate-3",
  },
  schoolWinner: {
    tile: "bg-green-700 text-white",
    Icon: School,
    tilt: "rotate-2",
  },
  finalist: { tile: "bg-red-600 text-white", Icon: Award, tilt: "-rotate-2" },
  communityMember: {
    tile: "bg-teal-400 text-neutral-900",
    Icon: Users,
    tilt: "rotate-3",
  },
  volunteer: {
    tile: "bg-pink-400 text-neutral-900",
    Icon: HandHeart,
    tilt: "-rotate-1",
  },
  ambassador: {
    tile: "bg-yellow-300 text-neutral-900",
    Icon: Megaphone,
    tilt: "rotate-2",
  },
};

/**
 * W4 "Badges, not a ladder": the six milestones as independent tile-badges,
 * each with how it is earned. No streaks, points, expiry or rankings
 * (SPEC §9.7.1). Native <details>, no JS.
 */
export async function BadgeConstellation({
  headingLevel = 2,
  id = "badges",
  intro = true,
  className,
}: {
  headingLevel?: HeadingLevel;
  /** id for the heading (for aria-labelledby). */
  id?: string;
  intro?: boolean;
  className?: string;
}) {
  const t = await getTranslations("about.badges");
  return (
    <div className={className}>
      {intro ? (
        <div className="max-w-3xl">
          <H
            level={headingLevel}
            id={id}
            className="text-(--section-heading,var(--ink))"
          >
            {t("title")}
          </H>
          <p className="mt-4 max-w-prose text-lead text-ink-muted">
            {t("lead")}
          </p>
        </div>
      ) : null}
      <ul
        className={cn(
          "grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-3 sm:gap-x-6",
          intro && "mt-10"
        )}
      >
        {BADGES.map((badge, i) => {
          const { tile, Icon, tilt } = LOOK[badge];
          return (
            <li key={badge} className={cn(i % 2 === 1 && "sm:mt-10")}>
              <details className="group rounded-3xl border-2 border-border bg-surface shadow-warm transition-[border-color,translate] open:border-border-strong motion-safe:hover:-translate-y-0.5">
                <summary className="flex min-h-11 cursor-pointer list-none flex-col items-center gap-3 rounded-3xl p-4 text-center sm:p-5 [&::-webkit-details-marker]:hidden">
                  <span
                    aria-hidden="true"
                    className={cn(
                      "grid size-16 place-items-center rounded-[22%] shadow-warm transition-transform sm:size-20 motion-safe:group-hover:rotate-0",
                      tile,
                      tilt
                    )}
                  >
                    <Icon className="size-8 sm:size-9" strokeWidth={2.25} />
                  </span>
                  <H
                    level={sub(headingLevel)}
                    className="font-display text-h5 leading-tight font-bold text-ink"
                  >
                    {t(`items.${badge}.name`)}
                  </H>
                  {LATER.has(badge) ? (
                    <Chip tone="neutral">{t("later")}</Chip>
                  ) : null}
                  <span className="inline-flex items-center gap-1 text-sm font-semibold text-link">
                    <Plus
                      aria-hidden="true"
                      className="size-4 transition-transform group-open:rotate-45"
                    />
                    {t("howEarned")}
                  </span>
                </summary>
                <p className="px-4 pb-5 text-center text-body text-ink-muted sm:px-5">
                  {t(`items.${badge}.earn`)}
                </p>
              </details>
            </li>
          );
        })}
      </ul>
      <p className="mt-10 max-w-prose rounded-2xl bg-surface p-4 text-body text-ink sm:mt-14">
        {t("note")}
      </p>
    </div>
  );
}
