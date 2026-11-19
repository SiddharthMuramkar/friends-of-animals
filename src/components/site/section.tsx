import type { ReactNode } from "react";

import type { SectionHue } from "@/lib/routes";
import { cn } from "@/lib/utils";

// Static class strings so Tailwind sees every one. Each hue sets the section's
// background tint and --section-heading, which headings and eyebrows use.
const TINT: Record<SectionHue, string> = {
  multi: "bg-surface-muted [--section-heading:var(--ink)]",
  neutral: "bg-surface-muted [--section-heading:var(--ink)]",
  red: "bg-section-red [--section-heading:var(--section-red-heading)]",
  green: "bg-section-green [--section-heading:var(--section-green-heading)]",
  blue: "bg-section-blue [--section-heading:var(--section-blue-heading)]",
  yellow: "bg-section-yellow [--section-heading:var(--section-yellow-heading)]",
  teal: "bg-section-teal [--section-heading:var(--section-teal-heading)]",
  pink: "bg-section-pink [--section-heading:var(--section-pink-heading)]",
};

const HEADING_ONLY: Record<SectionHue, string> = {
  multi: "[--section-heading:var(--ink)]",
  neutral: "[--section-heading:var(--ink)]",
  red: "[--section-heading:var(--section-red-heading)]",
  green: "[--section-heading:var(--section-green-heading)]",
  blue: "[--section-heading:var(--section-blue-heading)]",
  yellow: "[--section-heading:var(--section-yellow-heading)]",
  teal: "[--section-heading:var(--section-teal-heading)]",
  pink: "[--section-heading:var(--section-pink-heading)]",
};

const WIDTH = {
  prose: "max-w-3xl",
  default: "max-w-7xl",
  wide: "max-w-7xl",
} as const;

type SectionProps = {
  children: ReactNode;
  /** The page's section colour. */
  hue?: SectionHue;
  /** "tint" fills the band with the hue; "plain" keeps the paper. */
  tone?: "plain" | "tint";
  width?: keyof typeof WIDTH;
  id?: string;
  /** id of the heading that names this section. */
  labelledBy?: string;
  className?: string;
  innerClassName?: string;
};

/** A full-width band with a centred, padded container. */
export function Section({
  children,
  hue = "neutral",
  tone = "plain",
  width = "default",
  id,
  labelledBy,
  className,
  innerClassName,
}: SectionProps) {
  return (
    <section
      id={id}
      aria-labelledby={labelledBy}
      className={cn(
        "py-14 sm:py-20",
        tone === "tint" ? TINT[hue] : HEADING_ONLY[hue],
        className
      )}
    >
      <div className={cn("mx-auto px-4 sm:px-6", WIDTH[width], innerClassName)}>
        {children}
      </div>
    </section>
  );
}
