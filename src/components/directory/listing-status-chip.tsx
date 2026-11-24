import { BadgeCheck, CircleX, Clock, LogOut, PauseCircle } from "lucide-react";

import { Chip } from "@/components/site/chip";
import type { ListingStatus } from "@/server/modules/directory";

const LOOK = {
  pending_verification: { tone: "marigold", Icon: Clock },
  verified: { tone: "green", Icon: BadgeCheck },
  rejected: { tone: "pink", Icon: CircleX },
  suspended: { tone: "neutral", Icon: PauseCircle },
  withdrawn: { tone: "neutral", Icon: LogOut },
} as const;

/** A directory listing's status: an icon and words, never colour alone. */
export function ListingStatusChip({
  status,
  label,
}: {
  status: ListingStatus;
  /** directory.status.<status> */
  label: string;
}) {
  const { tone, Icon } = LOOK[status];
  return (
    <Chip tone={tone} icon={<Icon aria-hidden="true" />}>
      {label}
    </Chip>
  );
}
