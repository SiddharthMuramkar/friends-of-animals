import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";

import { isPlaceholder, type OrgFact } from "@/lib/site";
import { cn } from "@/lib/utils";

/**
 * Renders an organisation fact, or, while FOA hasn't confirmed it, a visible
 * dashed tile: "<what> · To be confirmed". Never invent the value.
 */
export async function Placeholder<T>({
  fact,
  children,
  className,
}: {
  fact: OrgFact<T>;
  /** How to render the confirmed value; defaults to String(value). */
  children?: (value: T) => ReactNode;
  className?: string;
}) {
  if (!isPlaceholder(fact)) {
    return <>{children ? children(fact) : String(fact)}</>;
  }
  const t = await getTranslations("common");
  return (
    <span
      className={cn(
        "inline-flex flex-wrap items-baseline gap-x-2 rounded-xl border-2 border-dashed border-border-strong bg-surface-muted px-2.5 py-0.5 text-sm",
        className
      )}
    >
      <span className="font-semibold text-ink">
        {t(`placeholders.${fact.key}`)}
      </span>
      <span className="text-ink-muted">{t("toBeConfirmed")}</span>
    </span>
  );
}
