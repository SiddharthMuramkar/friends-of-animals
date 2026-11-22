import Image from "next/image";
import type { CSSProperties } from "react";

import { type SiteArtId, siteArt } from "@/lib/art";
import { cn } from "@/lib/utils";

import styles from "./art.module.css";

export type Sticker = {
  id: SiteArtId;
  /** Position and size, e.g. "-top-6 left-[8%] w-12 sm:w-16". */
  className: string;
  /** Resting tilt in degrees. */
  tilt?: number;
};

/**
 * Small decorative stickers (doodles, neighbours) scattered around a
 * section's edges: never over a photo or text. They pop in as they scroll
 * into view and wiggle when pointed at; hidden from screen readers.
 * The parent must be positioned (relative) and must not clip them away.
 */
export function StickerScatter({
  stickers,
  className,
}: {
  stickers: readonly Sticker[];
  className?: string;
}) {
  return (
    <div
      aria-hidden="true"
      className={cn("pointer-events-none absolute inset-0", className)}
    >
      {stickers.map((s) => {
        // No blur placeholder, so the blur-free file: it rides in the RSC
        // payload.
        const { plain } = siteArt(s.id);
        return (
          <Image
            key={`${s.id}-${s.className}`}
            src={plain}
            alt=""
            sizes="96px"
            draggable={false}
            className={cn(styles.sticker, "h-auto", s.className)}
            style={{ "--tilt": `${s.tilt ?? 0}deg` } as CSSProperties}
          />
        );
      })}
    </div>
  );
}
