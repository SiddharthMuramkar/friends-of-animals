import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * The frame for a data table: rounded and bordered, and scrollable sideways
 * on its own when the table is wider than the screen, so the page never is.
 * A region (a named <section>) that takes focus so arrow keys can scroll it;
 * the table's caption names it: give the `<caption>` the id in `captionId`.
 */
export function TableScroller({
  captionId,
  children,
  className,
}: {
  captionId: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      aria-labelledby={captionId}
      // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a scrollable region must be focusable so keyboard users can scroll it (WCAG 2.1.1)
      tabIndex={0}
      className={cn(
        "overflow-x-auto rounded-3xl border-2 border-border bg-surface",
        className
      )}
    >
      {children}
    </section>
  );
}
