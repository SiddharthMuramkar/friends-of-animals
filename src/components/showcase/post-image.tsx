import Image from "next/image";

import { Photo } from "@/components/site/photo";
import type { PostImage } from "@/server/modules/cms/domain/post-view";
import { cn } from "@/lib/utils";

import { CardCover, CardCredit, TileCover } from "./card-cover";

// An uploaded image's public copy is already a resized WebP with its
// metadata stripped (post_cover_1200, post_inline_960), so next/image
// serves it as it is instead of resizing it again. That also keeps the
// public bucket's host out of next.config's image hosts.
const AS_IS = true;

const LCP_IMAGE = { loading: "eager", fetchPriority: "high" } as const;

/** A post's photo: a credited site photo, or an uploaded image's public copy. */
export function PostPhoto({
  image,
  sizes,
  preload = false,
  frame,
  frameCorner,
  caption,
  className,
}: {
  image: PostImage;
  sizes: string;
  /** Only for the page's one above-the-fold image. */
  preload?: boolean;
  frame?: "red" | "green" | "blue";
  frameCorner?: "top-left" | "top-right" | "bottom-left" | "bottom-right";
  caption?: string | undefined;
  className?: string;
}) {
  if (image.source === "site") {
    return (
      <Photo
        id={image.id}
        sizes={sizes}
        preload={preload}
        frame={frame}
        frameCorner={frameCorner}
        caption={caption}
        className={className}
      />
    );
  }
  return (
    <figure>
      <Image
        src={image.url}
        alt={image.alt}
        width={image.width}
        height={image.height}
        sizes={sizes}
        unoptimized={AS_IS}
        {...(preload ? LCP_IMAGE : {})}
        className={cn("h-auto w-full rounded-3xl object-cover", className)}
      />
      {caption ? (
        <figcaption className="mt-2 text-sm text-foreground">
          {caption}
        </figcaption>
      ) : null}
    </figure>
  );
}

/** A card's cover: the photo cropped to 4:3, or the tile pattern. */
export function PostCover({
  image,
  seed,
  sizes,
  className,
}: {
  image: PostImage | null;
  /** The post's slug: picks the tile pattern when there is no photo. */
  seed: string;
  sizes: string;
  className?: string;
}) {
  if (image === null) return <TileCover seed={seed} className={className} />;
  if (image.source === "site") {
    return <CardCover id={image.id} sizes={sizes} className={className} />;
  }
  return (
    <div
      className={cn(
        "relative aspect-4/3 overflow-hidden bg-surface-muted",
        className
      )}
    >
      <Image
        src={image.url}
        alt={image.alt}
        fill
        sizes={sizes}
        unoptimized={AS_IS}
        className="object-cover transition-transform duration-300 ease-out motion-safe:group-hover:scale-[1.03]"
      />
    </div>
  );
}

/** The place and credit under a card, for a site photo cover. */
export function PostCoverCredit({
  image,
  className,
}: {
  image: PostImage | null;
  className?: string;
}) {
  return image?.source === "site" ? (
    <CardCredit id={image.id} className={className} />
  ) : null;
}
