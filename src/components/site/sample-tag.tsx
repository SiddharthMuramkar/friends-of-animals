import { FlaskConical } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { Chip } from "./chip";

/** Marks example content on test sites (never rendered in production). */
export async function SampleTag({ className }: { className?: string }) {
  const t = await getTranslations("common");
  return (
    <Chip
      tone="marigold"
      icon={<FlaskConical aria-hidden="true" />}
      className={className}
    >
      {t("sample")}
    </Chip>
  );
}
