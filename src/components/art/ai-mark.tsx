import { getTranslations } from "next-intl/server";

import { cn } from "@/lib/utils";

/**
 * The hand-lettered "AI illustration" tag beside a meaningful drawing (ADR
 * 0003). Visual only: the drawing's alt text starts with the same words, so a
 * screen reader hears it once. Bold, so its strokes hold at 12px; "AI" is set
 * in the sans face, since Kalam's capital I is a plain stroke ("Al").
 */
export async function AiMark({ className }: { className?: string }) {
  const t = await getTranslations("art");
  return (
    <span
      aria-hidden="true"
      className={cn(
        "pointer-events-none inline-block -rotate-1 rounded-full border border-border bg-surface px-2.5 py-0.5 font-hand text-xs leading-5 font-bold whitespace-nowrap text-ink-muted shadow-warm",
        className
      )}
    >
      {t.rich("mark", {
        sans: (chunks) => (
          <span className="font-sans font-semibold">{chunks}</span>
        ),
      })}
    </span>
  );
}
