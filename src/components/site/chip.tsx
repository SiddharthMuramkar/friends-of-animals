import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

const TONE = {
  neutral: "border-border-strong bg-surface text-ink",
  blue: "border-blue-700 bg-blue-50 text-blue-800 dark:border-blue-400 dark:bg-info-bg dark:text-blue-300",
  green:
    "border-green-700 bg-green-50 text-green-800 dark:border-green-400 dark:bg-success-bg dark:text-green-300",
  pink: "border-pink-700 bg-pink-50 text-pink-800 dark:border-pink-400 dark:bg-section-pink dark:text-pink-300",
  marigold:
    "border-yellow-500 bg-accent-marigold text-accent-marigold-fg dark:border-yellow-300",
} as const;

/** A small label, e.g. a status. Pair colour with words; never colour alone. */
export function Chip({
  children,
  tone = "neutral",
  icon,
  className,
}: {
  children: ReactNode;
  tone?: keyof typeof TONE;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex min-h-7 max-w-full items-center gap-1.5 rounded-full border px-3 py-1 text-sm leading-tight font-semibold wrap-anywhere [&_svg]:size-4 [&_svg]:shrink-0",
        TONE[tone],
        className
      )}
    >
      {icon}
      {children}
    </span>
  );
}
