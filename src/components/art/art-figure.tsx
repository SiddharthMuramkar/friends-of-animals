import Image, { getImageProps } from "next/image";
import { preload as preloadResource } from "react-dom";

import { type PlainImage, type SiteArtId, siteArt } from "@/lib/art";
import { cn } from "@/lib/utils";

import { AiMark } from "./ai-mark";

// next/image loading props (constants: the lint rule bars literals here). As
// with Photo: the one above-the-fold image loads eagerly with no blur, every
// other one lazy-loads behind a blur.
const LCP_IMAGE = {
  loading: "eager",
  fetchPriority: "high",
  placeholder: "empty",
} as const;
// The LCP image from lg up only: lazy, so React adds no preload of its own
// (it does for an eager image) and a phone fetches it like any picture below
// the words; preloadFromLg fetches it early from lg. No blur, as on any LCP
// image.
const LG_LCP_IMAGE = { loading: "lazy", placeholder: "empty" } as const;
const LAZY_IMAGE = { placeholder: "blur" } as const;
/** Tailwind's lg breakpoint. */
const LG_MEDIA = "(min-width: 1024px)";
// The default quality: covers are full-bleed paintings, where 85 adds about
// a fifth to the bytes for no visible gain (line art keeps 85).
const QUALITY = 75;

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

/**
 * Preloads the image from lg up, at high priority, with the srcset, sizes
 * and quality its <img> picks from, so the <img> reuses that response.
 * React's preload() puts the link in <head>; a <link> element without an
 * href (which an image preload must not have) would stay in the body.
 */
function preloadFromLg(src: PlainImage, sizes: string) {
  const { props } = getImageProps({ src, alt: "", sizes, quality: QUALITY });
  preloadResource(props.src, {
    as: "image",
    imageSrcSet: props.srcSet,
    imageSizes: props.sizes,
    fetchPriority: "high",
    media: LG_MEDIA,
  });
}

/**
 * A full-bleed AI illustration (a story cover) framed like a Photo: rounded,
 * with an optional logo-tile corner, and always the AI mark, in a bottom
 * corner away from the tile. Stands where a story has no licensed photo.
 */
export function ArtFigure({
  id,
  sizes,
  preload = false,
  frame,
  frameCorner = "top-left",
  className,
  figureClassName,
}: {
  id: SiteArtId;
  sizes: string;
  /**
   * Only for the one above-the-fold image on a page (the LCP image). "lg"
   * when it is the LCP only from the lg breakpoint (1024px) up, e.g. beside
   * the headline there but under the words on a phone, where text must stay
   * the LCP: preloaded from lg, lazy below it.
   */
  preload?: boolean | "lg";
  frame?: keyof typeof TILE;
  frameCorner?: keyof typeof CORNER;
  /** Classes for the image, e.g. "aspect-4/3" to crop with object-cover. */
  className?: string;
  /** Classes for the outer figure (width, margins). */
  figureClassName?: string;
}) {
  const { src, plain, entry } = siteArt(id);
  if (preload === "lg") preloadFromLg(plain, sizes);
  const loading =
    preload === "lg" ? LG_LCP_IMAGE : preload ? LCP_IMAGE : LAZY_IMAGE;
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
          // The blur placeholder rides in the RSC payload: send it only
          // when it shows.
          src={loading === LAZY_IMAGE ? src : plain}
          alt={entry.alt ?? ""}
          sizes={sizes}
          quality={QUALITY}
          {...loading}
          className={cn("h-auto w-full rounded-3xl object-cover", className)}
        />
        {/* Clear of the frame tile: bottom-left when the tile peeks from
            the bottom-right corner. Below sm, where a story's cover takes
            the right half of the page, it keeps to the right edge, so with
            enlarged text a mark wider than the picture grows into the space
            on its left, not past the screen, and stays on one line. */}
        <AiMark
          className={cn(
            "absolute bottom-3",
            frame && frameCorner === "bottom-right"
              ? "left-3 max-sm:right-3 max-sm:left-auto"
              : "right-3"
          )}
        />
      </div>
    </figure>
  );
}
