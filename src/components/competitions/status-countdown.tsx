import { getFormatter, getTranslations } from "next-intl/server";

import { cn } from "@/lib/utils";
import type { UpcomingChange } from "@/server/modules/competitions/domain/status-schedule";

import { countdownText } from "./countdown-text";

/**
 * When the schedule next moves the competition, in IST with a relative
 * phrase. Server-rendered from the page's cached `now`: no client island.
 * Renders nothing when no change is ahead.
 */
export async function StatusCountdown({
  change,
  now,
  className,
}: {
  change: UpcomingChange;
  now: Date;
  className?: string;
}) {
  const [t, format] = await Promise.all([
    getTranslations("competitionStatus.countdown"),
    getFormatter(),
  ]);
  const text = countdownText(change, now, { t, format });
  if (!change || !text) return null;
  return (
    <p className={cn("text-sm text-ink-muted", className)}>
      <time dateTime={change.at.toISOString()}>{text}</time>
    </p>
  );
}
