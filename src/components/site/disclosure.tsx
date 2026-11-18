import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * A native <details>: 0 KB of JS, keyboard and screen-reader ready. Give a
 * group the same `name` to make it an exclusive accordion.
 */
export function Disclosure({
  summary,
  children,
  name,
  open,
  className,
}: {
  summary: ReactNode;
  children: ReactNode;
  name?: string;
  open?: boolean;
  className?: string;
}) {
  return (
    <details
      name={name}
      open={open}
      className={cn(
        "group rounded-3xl border-2 border-border bg-surface open:border-border-strong",
        className
      )}
    >
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-4 rounded-3xl px-5 py-3 font-semibold text-ink hover:bg-surface-muted [&::-webkit-details-marker]:hidden">
        <span>{summary}</span>
        <ChevronDown
          aria-hidden="true"
          className="size-5 shrink-0 text-ink-muted transition-transform duration-200 group-open:rotate-180"
        />
      </summary>
      <div className="px-5 pt-1 pb-5 text-ink [&>*+*]:mt-3">{children}</div>
    </details>
  );
}
