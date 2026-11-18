import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

import { ButtonLink } from "./button-link";
import { TileMarker } from "./tile";

/**
 * A friendly, honest state for something that isn't open yet (e.g. a CTA whose
 * page is built later): says what will happen and offers a real way back.
 * Never link a visitor to a 404.
 */
export function ExplainState({
  title,
  children,
  back,
  headingLevel = "h2",
  className,
}: {
  title: ReactNode;
  children: ReactNode;
  back?: { href: string; label: ReactNode };
  headingLevel?: "h1" | "h2" | "h3";
  className?: string;
}) {
  const Heading = headingLevel;
  return (
    <div
      className={cn(
        "rounded-3xl border-2 border-dashed border-border-strong bg-surface p-6 shadow-warm sm:p-8",
        className
      )}
    >
      <div aria-hidden="true" className="flex gap-1.5">
        <TileMarker hue="red" size="sm" />
        <TileMarker hue="yellow" size="sm" />
        <TileMarker hue="teal" size="sm" />
      </div>
      <Heading className="mt-4 text-h3">{title}</Heading>
      <div className="mt-3 max-w-prose text-ink-muted [&>*+*]:mt-3">
        {children}
      </div>
      {back ? (
        <ButtonLink href={back.href} variant="secondary" className="mt-6">
          {back.label}
        </ButtonLink>
      ) : null}
    </div>
  );
}
