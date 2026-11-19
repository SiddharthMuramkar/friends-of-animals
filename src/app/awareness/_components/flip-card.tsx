"use client";

import { RotateCw } from "lucide-react";
import { type ReactNode, useState } from "react";

import { cn } from "@/lib/utils";

/**
 * A two-sided card. A real toggle button (aria-pressed) turns it; the hidden
 * face is inert so focus never lands on it. Reduced motion: no 3D turn, the
 * faces simply swap.
 */
export function FlipCard({
  front,
  back,
  label,
  buttonText,
  className,
}: {
  front: ReactNode;
  back: ReactNode;
  /** Accessible name of the toggle, e.g. "How to be a good neighbour to the cow". */
  label: string;
  buttonText: string;
  className?: string;
}) {
  const [flipped, setFlipped] = useState(false);
  return (
    <div className={cn("flex flex-col perspective-distant", className)}>
      <div
        className={cn(
          "grid flex-1 transition-transform duration-500 ease-out transform-3d motion-reduce:transition-none",
          flipped && "motion-safe:rotate-y-180"
        )}
      >
        <div
          inert={flipped}
          className={cn(
            "[grid-area:1/1] backface-hidden",
            flipped && "motion-reduce:invisible"
          )}
        >
          {front}
        </div>
        <div
          inert={!flipped}
          className={cn(
            "[grid-area:1/1] backface-hidden motion-safe:rotate-y-180",
            !flipped && "invisible motion-safe:visible"
          )}
        >
          {back}
        </div>
      </div>
      <button
        type="button"
        aria-pressed={flipped}
        aria-label={label}
        onClick={() => setFlipped((f) => !f)}
        className="group mt-3 inline-flex min-h-11 items-center justify-center gap-2 self-start rounded-full border-2 border-border-strong bg-surface px-5 font-semibold text-ink transition-[background-color,border-color] duration-200 hover:border-ink aria-pressed:border-teal-700 aria-pressed:bg-section-teal"
      >
        <RotateCw
          aria-hidden="true"
          className="size-5 transition-transform duration-300 motion-safe:group-aria-pressed:rotate-180"
        />
        <span>{buttonText}</span>
      </button>
    </div>
  );
}
