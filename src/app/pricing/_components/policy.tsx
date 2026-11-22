import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";

import { PageHeader } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { TileMarker } from "@/components/site/tile";
import { showsPlaceholders } from "@/lib/site";
import { cn } from "@/lib/utils";

/**
 * Header band + "The short version" box for /pricing and /refunds, in the
 * same shape as the other policy pages (LegalDocument).
 */
export function PolicyTop({
  eyebrow,
  title,
  updated,
  shortTitle,
  items,
}: {
  eyebrow: string;
  title: string;
  updated: string;
  shortTitle: string;
  items: readonly string[];
}) {
  return (
    <>
      <Section hue="neutral" tone="tint" className="pt-10 pb-12 sm:pt-14">
        <PageHeader eyebrow={eyebrow} tile="blue" title={title} />
        <p className="mt-5 text-sm font-semibold text-ink-muted">{updated}</p>
      </Section>
      <Section hue="neutral" className="pt-10 pb-0 sm:pt-12 sm:pb-0">
        <section
          aria-labelledby="short-version"
          className="max-w-3xl rounded-3xl border-2 border-blue-700 bg-section-blue px-4 py-6 sm:p-8 dark:border-blue-400"
        >
          <h2
            id="short-version"
            className="flex items-center gap-2.5 font-display text-h4 leading-tight text-(--section-blue-heading)"
          >
            <TileMarker hue="blue" />
            <span className="min-w-0">{shortTitle}</span>
          </h2>
          <ul className="mt-4 space-y-3 text-lead text-ink">
            {items.map((item) => (
              <li key={item} className="flex gap-3">
                <span
                  aria-hidden="true"
                  className="mt-2.5 size-2.5 shrink-0 rounded-[22%] bg-blue-700 dark:bg-blue-400"
                />
                <span className="min-w-0">{item}</span>
              </li>
            ))}
          </ul>
        </section>
      </Section>
    </>
  );
}

/** A titled block of policy text. */
export function PolicyBlock({
  title,
  id,
  children,
  className,
}: {
  title: string;
  id: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section aria-labelledby={id} className={cn("scroll-mt-24", className)}>
      <h2 id={id} className="text-h3">
        {title}
      </h2>
      <div className="mt-4 text-ink [&>*+*]:mt-3">{children}</div>
    </section>
  );
}

/**
 * A dashed "To be confirmed" tile for a policy fact not set yet. Production
 * renders nothing: leave out its line there too (showsPlaceholders()).
 */
export async function Tbc({ label }: { label: string }) {
  if (!showsPlaceholders()) return null;
  const t = await getTranslations("common");
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-2 rounded-xl border-2 border-dashed border-border-strong bg-surface-muted px-2.5 py-0.5 text-sm">
      <span className="font-semibold text-ink">{label}</span>
      <span className="text-ink-muted">{t("toBeConfirmed")}</span>
    </span>
  );
}
