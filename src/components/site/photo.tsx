import Image from "next/image";

import { needsVisibleCredit, shortCredit } from "@/lib/images/credits";
import { type SiteImageId, siteImage } from "@/lib/images";
import { cn } from "@/lib/utils";

// next/image loading props (constants: the lint rule bars literals here).
// The LCP image loads eagerly at high priority: the docs prefer that to
// `preload`, and React still adds the <link rel="preload"> for an eager
// image. It gets no blur, which would paint after the photo and become the
// LCP entry (#37). Every other photo lazy-loads behind a blur.
const LCP_IMAGE = {
  loading: "eager",
  fetchPriority: "high",
  placeholder: "empty",
} as const;
const LAZY_IMAGE = { placeholder: "blur" } as const;

const TILE = {
  red: "bg-red-600",
  green: "bg-green-600",
  blue: "bg-blue-600",
} as const;

// A caption written on a coloured note, like the home hero's (ink on light
// tile colours only: never white on these).
const NOTE = {
  yellow: "bg-yellow-300",
  pink: "bg-pink-400",
  teal: "bg-teal-400",
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
  /**
   * Only for the one above-the-fold image on a page (the LCP image): loads it
   * eagerly at high fetch priority, with no blur placeholder.
   */
  preload?: boolean;
  /** One logo-tile-coloured rounded square peeking from a corner. */
  frame?: keyof typeof TILE;
  frameCorner?: keyof typeof CORNER;
  /** Defaults to on for CC BY and CC BY-SA images, which require it. */
  showCredit?: boolean;
  /** Translated caption; the verified place is always added after it. */
  caption?: string;
  /**
   * Show the caption as a handwritten note pinned over the photo's bottom
   * edge, with the place and credit on the line below. Keep it to 5 words.
   */
  captionNote?: keyof typeof NOTE;
  /** Classes for the image, e.g. "aspect-4/5" to crop with object-cover. */
  className?: string;
  /** Classes for the outer figure (width, margins). */
  figureClassName?: string;
};

/**
 * A credited site photo: next/image with a blur placeholder (none on the LCP
 * image), an optional tile frame, the real place in the caption and a short
 * credit for CC images.
 */
export function Photo({
  id,
  sizes,
  preload = false,
  frame,
  frameCorner = "top-left",
  showCredit,
  caption,
  captionNote,
  className,
  figureClassName,
}: Props) {
  const { src, credit, focal } = siteImage(id);
  const creditVisible = showCredit ?? needsVisibleCredit(credit.licence);
  const hasCaption = caption !== undefined || creditVisible;
  const placeAndCredit = (
    <>
      {credit.place ? <span className="min-w-0">{credit.place}</span> : null}
      {creditVisible ? (
        <a
          href={credit.sourceUrl}
          className="inline-flex min-h-6 max-w-full items-center wrap-anywhere underline decoration-1 underline-offset-2 hover:text-foreground"
        >
          {shortCredit(credit)}
        </a>
      ) : null}
    </>
  );

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
          {...(preload ? LCP_IMAGE : LAZY_IMAGE)}
          style={{ objectPosition: `${focal[0] * 100}% ${focal[1] * 100}%` }}
          className={cn("h-auto w-full rounded-3xl object-cover", className)}
        />
      </div>
      {hasCaption ? (
        <figcaption
          className={cn(
            "mt-2 flex flex-wrap gap-x-2 text-sm text-muted-foreground",
            captionNote &&
              "relative -mt-5 flex-col items-start gap-y-2 px-3 max-sm:text-xs"
          )}
        >
          {caption && captionNote ? (
            <span
              className={cn(
                "max-w-full -rotate-2 rounded-2xl px-3 py-1 font-hand text-base leading-snug text-neutral-900 shadow-warm sm:text-lead",
                NOTE[captionNote]
              )}
            >
              {caption}
            </span>
          ) : caption ? (
            <span className="min-w-0 text-foreground">{caption}</span>
          ) : null}
          {captionNote ? (
            <span className="flex min-w-0 max-w-full flex-wrap gap-x-2">
              {placeAndCredit}
            </span>
          ) : (
            placeAndCredit
          )}
        </figcaption>
      ) : null}
    </figure>
  );
}
