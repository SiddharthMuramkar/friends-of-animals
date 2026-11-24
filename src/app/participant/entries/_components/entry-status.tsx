import { getTranslations } from "next-intl/server";

import { Chip } from "@/components/site/chip";
import type { EntryStatus } from "@/server/modules/entries";

const TONES: Partial<Record<EntryStatus, "green" | "marigold" | "pink">> = {
  submitted: "green",
  processing: "marigold",
  rejected: "pink",
  failed: "pink",
};

export async function EntryStatusChip({ status }: { status: EntryStatus }) {
  const t = await getTranslations("entries.status");
  return <Chip tone={TONES[status] ?? "neutral"}>{t(status)}</Chip>;
}
