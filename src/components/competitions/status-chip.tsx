import {
  Ban,
  CalendarClock,
  DoorClosed,
  DoorOpen,
  Gavel,
  type LucideIcon,
  PencilLine,
} from "lucide-react";
import { getTranslations } from "next-intl/server";

import { Chip } from "@/components/site/chip";
import type { CompetitionStatus } from "@/server/modules/competitions/domain/status-machine";

const LOOK: Record<
  CompetitionStatus,
  { icon: LucideIcon; tone: "neutral" | "blue" | "green" | "pink" }
> = {
  draft: { icon: PencilLine, tone: "neutral" },
  published: { icon: CalendarClock, tone: "blue" },
  registration_open: { icon: DoorOpen, tone: "green" },
  registration_closed: { icon: DoorClosed, tone: "pink" },
  school_judging: { icon: Gavel, tone: "blue" },
  cancelled: { icon: Ban, tone: "neutral" },
};

/** A competition's stored status, as icon plus word. */
export async function CompetitionStatusChip({
  status,
  className,
}: {
  status: CompetitionStatus;
  className?: string;
}) {
  const t = await getTranslations("competitionStatus.label");
  const { icon: Icon, tone } = LOOK[status];
  return (
    <Chip tone={tone} icon={<Icon aria-hidden="true" />} className={className}>
      {t(status)}
    </Chip>
  );
}
