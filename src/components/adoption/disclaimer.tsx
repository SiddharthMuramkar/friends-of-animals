import { HeartHandshake } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { cn } from "@/lib/utils";

/**
 * The sentence every adoption page carries (#129): FOA facilitates, and
 * the organisation that lists an animal is responsible for it. Its words
 * wait for counsel's review (HR-61).
 */
export async function AdoptionDisclaimer({
  className,
}: {
  className?: string;
}) {
  const t = await getTranslations("adoption.disclaimer");
  return (
    <aside
      aria-label={t("label")}
      data-testid="adoption-disclaimer"
      className={cn(
        "flex items-start gap-3 rounded-3xl border-2 border-dashed border-border-strong bg-surface p-5 text-ink sm:p-6",
        className
      )}
    >
      <HeartHandshake aria-hidden="true" className="mt-0.5 size-6 shrink-0" />
      <p>{t("body")}</p>
    </aside>
  );
}
