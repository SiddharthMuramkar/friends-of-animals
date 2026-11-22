import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * A native <details>: 0 KB of JS, keyboard and screen-reader ready. Each one
 * opens on its own. There is deliberately no `name` grouping: an exclusive
 * accordion closes the open one above, and the tapped summary jumps off the
 * top of the screen.
 */
export function Disclosure({
  summary,
  children,
  open,
  className,
}: {
  summary: ReactNode;
  children: ReactNode;
  open?: boolean;
  className?: string;
}) {
  return (
    <details
      open={open}
      className={cn(
        "rounded-3xl border-2 border-border bg-surface open:border-border-strong",
        className
      )}
    >
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-4 rounded-3xl px-[min(1.25rem,8%)] py-3 font-semibold text-ink hover:bg-surface-muted [&::-webkit-details-marker]:hidden">
        <span className="min-w-0">{summary}</span>
        {/* Its own <details> only: group-open would match an open parent. */}
        <ChevronDown
          aria-hidden="true"
          className="size-5 shrink-0 text-ink-muted transition-transform duration-200 [details[open]>summary>&]:rotate-180"
        />
      </summary>
      <div className="px-[min(1.25rem,8%)] pt-1 pb-5 text-ink [&>*+*]:mt-3">
        {children}
      </div>
    </details>
  );
}
