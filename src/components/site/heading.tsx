import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

import { type TileHue, TileMarker } from "./tile";

/** Short label above a heading, led by a tile. */
export function Eyebrow({
  children,
  tile = "blue",
  className,
}: {
  children: ReactNode;
  tile?: TileHue;
  className?: string;
}) {
  return (
    <p
      className={cn(
        "flex items-center gap-2.5 font-display text-lead leading-tight font-semibold text-(--section-heading,var(--ink))",
        className
      )}
    >
      <TileMarker hue={tile} />
      <span className="min-w-0">{children}</span>
    </p>
  );
}

type HeadingBlockProps = {
  title: ReactNode;
  eyebrow?: ReactNode;
  tile?: TileHue;
  lead?: ReactNode;
  id?: string;
  className?: string;
};

/** The page's one <h1>, with optional eyebrow and lead paragraph. */
export function PageHeader({
  title,
  eyebrow,
  tile,
  lead,
  id,
  className,
}: HeadingBlockProps) {
  return (
    <header className={cn("max-w-3xl", className)}>
      {eyebrow ? <Eyebrow tile={tile}>{eyebrow}</Eyebrow> : null}
      <h1
        id={id}
        className={cn("text-(--section-heading,var(--ink))", eyebrow && "mt-3")}
      >
        {title}
      </h1>
      {lead ? (
        <p className="mt-5 max-w-prose text-lead text-ink-muted">{lead}</p>
      ) : null}
    </header>
  );
}

/** A section's <h2>; pass `id` and give it to Section's `labelledBy`. */
export function SectionHeading({
  title,
  eyebrow,
  tile,
  lead,
  id,
  className,
}: HeadingBlockProps) {
  return (
    <div className={cn("max-w-3xl", className)}>
      {eyebrow ? <Eyebrow tile={tile}>{eyebrow}</Eyebrow> : null}
      <h2
        id={id}
        className={cn("text-(--section-heading,var(--ink))", eyebrow && "mt-2")}
      >
        {title}
      </h2>
      {lead ? (
        <p className="mt-4 max-w-prose text-lead text-ink-muted">{lead}</p>
      ) : null}
    </div>
  );
}
