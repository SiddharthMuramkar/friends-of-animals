import { BadgeCheck, CircleX, Clock, PauseCircle } from "lucide-react";

import { Chip } from "@/components/site/chip";
import type { InstitutionStatus } from "@/server/modules/institutions";

const LOOK = {
  pending_verification: { tone: "marigold", Icon: Clock },
  verified: { tone: "green", Icon: BadgeCheck },
  rejected: { tone: "pink", Icon: CircleX },
  suspended: { tone: "neutral", Icon: PauseCircle },
} as const;

/** An institution's status: an icon and words, never colour alone. */
export function InstitutionStatusChip({
  status,
  label,
}: {
  status: InstitutionStatus;
  /** institutions.status.<status> */
  label: string;
}) {
  const { tone, Icon } = LOOK[status];
  return (
    <Chip tone={tone} icon={<Icon aria-hidden="true" />}>
      {label}
    </Chip>
  );
}
