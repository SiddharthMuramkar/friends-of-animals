import { getTranslations } from "next-intl/server";

import { Chip } from "@/components/site/chip";
import type { SafeguardingReportStatus } from "@/server/modules/safeguarding";

/** New reports stand out; resolved ones step back. Words, never colour alone. */
const TONE = {
  new: "pink",
  triaged: "marigold",
  investigating: "blue",
  escalated: "blue",
  resolved: "green",
} as const satisfies Record<SafeguardingReportStatus, string>;

export async function StatusChip({
  status,
}: {
  status: SafeguardingReportStatus;
}) {
  const t = await getTranslations("adminSafeguarding.statuses");
  return <Chip tone={TONE[status]}>{t(status)}</Chip>;
}
