import { BookOpen } from "lucide-react";

import { cn } from "@/lib/utils";

/** The short "Easy read" line for young readers (grade ≤ 6), shown first. */
export function EasyRead({
  label,
  children,
  className,
}: {
  label: string;
  children: string;
  className?: string;
}) {
  return (
    <p
      className={cn(
        "flex max-w-prose items-start gap-3 rounded-2xl border-2 border-border bg-surface p-4 text-lead text-ink shadow-warm",
        className
      )}
    >
      <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-yellow-200 px-3 py-1 text-sm font-bold text-neutral-900">
        <BookOpen aria-hidden="true" className="size-4" />
        {label}
      </span>
      <span>{children}</span>
    </p>
  );
}
