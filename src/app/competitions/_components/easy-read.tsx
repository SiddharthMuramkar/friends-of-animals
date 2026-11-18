import type { ReactNode } from "react";

import { type TileHue, TileMarker } from "@/components/site/tile";
import { cn } from "@/lib/utils";

/**
 * The "Easy read" kid layer (DIRECTION §1): one or two short sentences, first,
 * in big type. Adult detail follows on the page. Shared by the P2 pages.
 */
export function EasyRead({
  label,
  children,
  tile = "yellow",
  className,
}: {
  /** Translated "Easy read". */
  label: string;
  children: ReactNode;
  tile?: TileHue;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-3xl border-2 border-(--section-heading,var(--ink)) bg-surface p-5 shadow-warm sm:p-6",
        className
      )}
    >
      <p className="flex items-center gap-2 font-hand text-lead leading-tight text-(--section-heading,var(--ink))">
        <TileMarker hue={tile} />
        {label}
      </p>
      <div className="mt-2 font-display text-h4 leading-snug text-ink [&>*+*]:mt-2">
        {children}
      </div>
    </div>
  );
}
