import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";

import { isFactShown, isPlaceholder, type OrgFact } from "@/lib/site";
import { cn } from "@/lib/utils";

/**
 * Renders an organisation fact, or, while FOA hasn't confirmed it, a visible
 * dashed tile: "<what> · To be confirmed". Never invent the value. For an
 * email or phone number, use <ContactFact>, which renders a tappable link.
 * Production renders nothing for an unconfirmed fact: check isFactShown()
 * and leave out its label and item too.
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
  if (!isFactShown(fact)) return null;
  const t = await getTranslations("common");
  return (
    <span
      className={cn(
        "inline-flex max-w-full flex-wrap items-baseline gap-x-2 rounded-xl border-2 border-dashed border-border-strong bg-surface-muted px-[min(0.625rem,8%)] py-0.5 text-sm",
        className
      )}
    >
      <span className="min-w-0 font-semibold text-ink">
        {t(`placeholders.${fact.key}`)}
      </span>
      <span className="min-w-0 text-ink-muted">{t("toBeConfirmed")}</span>
    </span>
  );
}
