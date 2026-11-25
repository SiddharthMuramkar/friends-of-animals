import { getTranslations } from "next-intl/server";

import { Chip } from "@/components/site/chip";
import type { PrivacyRequestStatus } from "@/server/modules/privacy/requests";

/** Open requests stand out; closed ones step back. Words, never colour alone. */
const TONE = {
  submitted: "pink",
  in_progress: "marigold",
  completed: "green",
  partially_completed: "green",
  rejected: "neutral",
  cancelled: "neutral",
} as const satisfies Record<PrivacyRequestStatus, string>;

export async function RequestStatusChip({
  status,
  namespace,
}: {
  status: PrivacyRequestStatus;
  /** Requesters and officers word the statuses differently. */
  namespace: "privacyRequests.statuses" | "adminGrievance.statuses";
}) {
  const t = await getTranslations(namespace);
  return <Chip tone={TONE[status]}>{t(status)}</Chip>;
}
