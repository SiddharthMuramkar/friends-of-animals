import { getTranslations } from "next-intl/server";

import { Chip } from "@/components/site/chip";
import type { EntryStatus } from "@/server/modules/entries";
import type { EntryFormat } from "@/server/modules/entries/rules";

const TONES: Partial<Record<EntryStatus, "green" | "marigold" | "pink">> = {
  submitted: "green",
  processing: "marigold",
  rejected: "pink",
  failed: "pink",
};

/** The checks an entry is still in name its kind of work (#86). */
const BY_FORMAT = new Set<EntryStatus>(["processing", "rejected", "failed"]);

export async function EntryStatusChip({
  status,
  format = "image",
}: {
  status: EntryStatus;
  format?: EntryFormat;
}) {
  const t = await getTranslations("entries");
  const label =
    format !== "image" && BY_FORMAT.has(status)
      ? t(
          `statusFormat.${format}.${status as "processing" | "rejected" | "failed"}`
        )
      : t(`status.${status}`);
  return <Chip tone={TONES[status] ?? "neutral"}>{label}</Chip>;
}
