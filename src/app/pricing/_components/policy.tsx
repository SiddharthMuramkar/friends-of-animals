import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";

import { PageHeader } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { type TileHue, TileMarker } from "@/components/site/tile";
import { cn } from "@/lib/utils";

/** Header + "The short version" box for /pricing and /refunds. */
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
  const tiles: TileHue[] = ["red", "green", "blue", "yellow", "teal", "pink"];
  return (
    <Section hue="neutral" tone="tint" width="prose" className="pt-10 sm:pt-14">
      <PageHeader eyebrow={eyebrow} tile="blue" title={title} />
      <p className="mt-3 text-sm text-ink-muted">{updated}</p>
      <section
        aria-labelledby="short-version"
        className="mt-8 rounded-3xl border-2 border-ink bg-surface p-6 shadow-warm sm:p-8"
      >
        <h2 id="short-version" className="text-h3">
          {shortTitle}
        </h2>
        <ul className="mt-5 grid gap-4">
          {items.map((item, i) => (
            <li key={item} className="flex items-start gap-3 text-lead">
              <TileMarker hue={tiles[i % tiles.length]} className="mt-1.5" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </section>
    </Section>
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

/** A dashed "To be confirmed" tile for a policy fact not set yet. */
export async function Tbc({ label }: { label: string }) {
  const t = await getTranslations("common");
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-2 rounded-xl border-2 border-dashed border-border-strong bg-surface-muted px-2.5 py-0.5 text-sm">
      <span className="font-semibold text-ink">{label}</span>
      <span className="text-ink-muted">{t("toBeConfirmed")}</span>
    </span>
  );
}
