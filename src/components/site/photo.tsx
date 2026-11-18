import Image from "next/image";

import { needsVisibleCredit, shortCredit } from "@/lib/images/credits";
import { type SiteImageId, siteImage } from "@/lib/images";
import { cn } from "@/lib/utils";

const TILE = {
  red: "bg-red-600",
  green: "bg-green-600",
  blue: "bg-blue-600",
} as const;

const CORNER = {
  "top-left": "-top-3 -left-3",
  "top-right": "-top-3 -right-3",
  "bottom-left": "-bottom-3 -left-3",
  "bottom-right": "-bottom-3 -right-3",
} as const;

type Props = {
  id: SiteImageId;
  /** Required: how wide the image renders, e.g. "(min-width: 1024px) 40vw, 92vw". */
  sizes: string;
  /** Only for the one above-the-fold image on a page (the LCP image). */
  preload?: boolean;
  /** One logo-tile-coloured rounded square peeking from a corner. */
  frame?: keyof typeof TILE;
  frameCorner?: keyof typeof CORNER;
  /** Defaults to on for CC BY and CC BY-SA images, which require it. */
  showCredit?: boolean;
  /** Translated caption; the verified place is always added after it. */
  caption?: string;
  /** Classes for the image, e.g. "aspect-4/5" to crop with object-cover. */
  className?: string;
  /** Classes for the outer figure (width, margins). */
  figureClassName?: string;
};

/**
 * A credited site photo: next/image with a blur placeholder, an optional tile
 * frame, the real place in the caption and a short credit for CC images.
 */
export function Photo({
  id,
  sizes,
  preload = false,
  frame,
  frameCorner = "top-left",
  showCredit,
  caption,
  className,
  figureClassName,
}: Props) {
  const { src, credit, focal } = siteImage(id);
  const creditVisible = showCredit ?? needsVisibleCredit(credit.licence);
  const hasCaption = caption !== undefined || creditVisible;

  return (
    <figure className={cn("relative", figureClassName)}>
      <div className="relative isolate">
        {frame ? (
          <span
            aria-hidden="true"
            className={cn(
              "absolute -z-10 size-20 rounded-[22%] sm:size-28",
              TILE[frame],
              CORNER[frameCorner]
            )}
          />
        ) : null}
        <Image
          src={src}
          alt={credit.alt}
          sizes={sizes}
          preload={preload}
          placeholder="blur"
          style={{ objectPosition: `${focal[0] * 100}% ${focal[1] * 100}%` }}
          className={cn("h-auto w-full rounded-3xl object-cover", className)}
        />
      </div>
      {hasCaption ? (
        <figcaption className="mt-2 flex flex-wrap gap-x-2 text-sm text-muted-foreground">
          {caption ? <span className="text-foreground">{caption}</span> : null}
          {credit.place ? <span>{credit.place}</span> : null}
          {creditVisible ? (
            <a
              href={credit.sourceUrl}
              className="underline decoration-1 underline-offset-2 hover:text-foreground"
            >
              {shortCredit(credit)}
            </a>
          ) : null}
        </figcaption>
      ) : null}
    </figure>
  );
}
