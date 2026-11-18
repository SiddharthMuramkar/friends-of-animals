import {
  CalendarClock,
  CircleSlash,
  DoorOpen,
  Hourglass,
  type LucideIcon,
  Trophy,
} from "lucide-react";
import { getTranslations } from "next-intl/server";

import { Chip } from "@/components/site/chip";
import type { CompetitionStatus } from "@/content/sample/model";
import { type StatusLabel, statusChip } from "@/content/sample/selectors";

const ICON: Record<StatusLabel, LucideIcon> = {
  upcoming: CalendarClock,
  open: DoorOpen,
  inProgress: Hourglass,
  results: Trophy,
  cancelled: CircleSlash,
};

/** A competition's status as icon + word (SPEC §6.11). Nothing for drafts. */
export async function StatusChip({
  status,
  className,
}: {
  status: CompetitionStatus;
  className?: string;
}) {
  const chip = statusChip(status);
  if (!chip) return null;
  const t = await getTranslations("sample.status");
  const Icon = ICON[chip.label];
  return (
    <Chip
      tone={chip.tone}
      icon={<Icon aria-hidden="true" />}
      className={className}
    >
      {t(chip.label)}
    </Chip>
  );
}
