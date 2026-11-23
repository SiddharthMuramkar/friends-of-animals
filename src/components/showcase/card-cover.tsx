import Image from "next/image";

import { AiMark } from "@/components/art/ai-mark";
import type { TileHue } from "@/components/site/tile";
import { type SiteArtId, siteArt } from "@/lib/art";
import { type SiteImageId, siteImage } from "@/lib/images";
import { needsVisibleCredit, shortCredit } from "@/lib/images/credits";
import { cn } from "@/lib/utils";

// next/image placeholder mode (a constant: the lint rule bars literals here).
const BLUR = "blur";
// The default quality: covers are full-bleed paintings, where 85 adds about
// a fifth to the bytes for no visible gain (line art keeps 85).
const ART_QUALITY = 75;

/** A card's cover photo, cropped by aspect with the image's focal point. */
export function CardCover({
  id,
  sizes,
  className,
}: {
  id: SiteImageId;
  sizes: string;
  className?: string;
}) {
  const { src, credit, focal } = siteImage(id);
  return (
    <div
      className={cn(
        "relative aspect-4/3 overflow-hidden bg-surface-muted",
        className
      )}
    >
      <Image
        src={src}
        alt={credit.alt}
        fill
        sizes={sizes}
        placeholder={BLUR}
        style={{ objectPosition: `${focal[0] * 100}% ${focal[1] * 100}%` }}
        className="object-cover transition-transform duration-300 ease-out motion-safe:group-hover:scale-[1.03]"
      />
    </div>
  );
}

/**
 * A card's illustrated cover: an AI illustration (labelled) for a story with
 * no licensed photo, cropped by aspect like a photo cover.
 */
export function ArtCover({
  id,
  sizes,
  className,
}: {
  id: SiteArtId;
  sizes: string;
  className?: string;
}) {
  const { src, entry } = siteArt(id);
  return (
    <div
      className={cn(
        "relative aspect-4/3 overflow-hidden bg-surface-muted",
        className
      )}
    >
      <Image
        src={src}
        alt={entry.alt ?? ""}
        fill
        sizes={sizes}
        quality={ART_QUALITY}
        placeholder={BLUR}
        className="object-cover transition-transform duration-300 ease-out motion-safe:group-hover:scale-[1.03]"
      />
      <AiMark className="absolute right-3 bottom-3" />
    </div>
  );
}

/**
 * The real place and, for CC BY images, the short credit, under a card. Only
 * the credit link sits above the card's stretched link, so it stays
 * clickable while a tap on the place or the blank line still opens the card.
 */
export function CardCredit({
  id,
  raised = true,
  className,
}: {
  id: SiteImageId;
  /**
   * Lift the link above a stretched card link. Turn it off on a card with no
   * stretched link: inside a flip card, the extra layer makes iPhone Safari
   * paint the credit mirrored on the back face.
   */
  raised?: boolean;
  className?: string;
}) {
  const { credit } = siteImage(id);
  const visible = needsVisibleCredit(credit.licence);
  if (!credit.place && !visible) return null;
  return (
    <p
      className={cn("flex flex-wrap gap-x-2 text-xs text-ink-muted", className)}
    >
      {credit.place ? <span>{credit.place}</span> : null}
      {visible ? (
        <a
          href={credit.sourceUrl}
          className={cn(
            "inline-flex min-h-6 items-center underline decoration-1 underline-offset-2 hover:text-ink",
            raised && "relative z-10"
          )}
        >
          {shortCredit(credit)}
        </a>
      ) : null}
    </p>
  );
}

const TILES: TileHue[] = ["red", "green", "blue", "yellow", "teal", "pink"];
const BG: Record<TileHue, string> = {
  red: "bg-red-500",
  green: "bg-green-500",
  blue: "bg-blue-600",
  yellow: "bg-yellow-300",
  teal: "bg-teal-400",
  pink: "bg-pink-400",
};

/** A tile-pattern cover for a story with no licensed photo. Decorative. */
export function TileCover({
  seed,
  className,
}: {
  seed: string;
  className?: string;
}) {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const cells = Array.from({ length: 12 }, (_, i) => {
    const v = (h >>> (i % 24)) + i * 7;
    return v % 5 === 0 ? null : TILES[v % TILES.length]!;
  });
  return (
    <div
      aria-hidden="true"
      className={cn(
        "grid aspect-4/3 grid-cols-4 grid-rows-3 gap-3 bg-section-yellow p-5",
        className
      )}
    >
      {cells.map((hue, i) => (
        <span
          key={i}
          className={cn(
            "rounded-[22%] transition-transform duration-300 ease-out",
            hue ? BG[hue] : "border-2 border-dashed border-yellow-700/40",
            i % 3 === 0 && "motion-safe:group-hover:-rotate-6",
            i % 3 === 1 && "motion-safe:group-hover:rotate-6"
          )}
        />
      ))}
    </div>
  );
}
