import { getTranslations } from "next-intl/server";
import Image from "next/image";
import type { CSSProperties } from "react";

import { AiMark } from "@/components/art/ai-mark";
import { NEIGHBOURS } from "@/content/awareness/neighbours";
import { STREET_SCENE } from "@/content/awareness/street-scene";
import { siteArt } from "@/lib/art";
import { cn } from "@/lib/utils";

import { DismissibleLink } from "./dismissible-link";
import styles from "./street-scene.module.css";

// next/image placeholder mode and quality (constants: the lint rule bars
// literals here). The default quality: the scene is gouache, and the higher
// one (85) is for ink line art.
const BLUR = "blur";
const QUALITY = 75;

// The picture's width: the section's padding (1rem, 1.5rem from sm), the
// figure's 2px border and its padding (0.5rem, 0.75rem from sm), capped by
// max-w-5xl (1024px, so 996px of picture from a 1072px viewport).
const SIZES =
  "(min-width: 1072px) 996px, (min-width: 640px) calc(100vw - 4.75rem), calc(100vw - 3.25rem)";

const NAMES = new Map(NEIGHBOURS.map((n) => [n.id, n.name]));

/**
 * "Spot the neighbour": the street illustration with a ring on each of the
 * ten neighbours. Each ring links to that neighbour's card below; its name
 * shows on focus, and on hover when the picture is wide enough to put it
 * beside the ring (street-scene.module.css). Escape hides it.
 */
export async function StreetScene({ className }: { className?: string }) {
  const t = await getTranslations("awareness.neighbours.street");
  const { src, entry } = siteArt(STREET_SCENE.artId);
  return (
    <figure
      className={cn(
        // Capped and centred, so the picture stays a part of the section
        // rather than a band of its own: at max-w-5xl the image is 996px
        // wide (SIZES). Clipped sideways only: a name near the edge, or one
        // made wide by a large text setting, must not widen the page. Names
        // above and below the picture still show.
        "mx-auto max-w-5xl overflow-x-clip rounded-3xl border-2 border-border bg-surface p-2 shadow-warm sm:p-3",
        className
      )}
    >
      <div className="relative">
        <Image
          src={src}
          alt={entry.alt ?? ""}
          sizes={SIZES}
          quality={QUALITY}
          placeholder={BLUR}
          className="h-auto w-full rounded-2xl"
        />
        <ul
          // oxlint-disable-next-line jsx-a11y/no-redundant-roles -- Safari drops the list role once list-style is none (WebKit bug 170179)
          role="list"
          aria-label={t("listLabel")}
          className={cn("absolute inset-0", styles.scene)}
        >
          {STREET_SCENE.spots.map((spot) => (
            <li
              key={spot.neighbour}
              className={cn(
                styles.spot,
                // The name's side of the ring, and its edge of the picture
                // when the picture is too small for names beside the rings.
                styles[spot.label],
                spot.y < 50 ? styles.top : styles.bottom,
                spot.x < 25 && styles.start,
                spot.x > 75 && styles.end
              )}
              style={
                {
                  left: `${spot.x}%`,
                  top: `${spot.y}%`,
                  "--y": spot.y,
                } as CSSProperties
              }
            >
              {/* Replaces the history entry, scrolls to and focuses the
                  card: a plain hash link breaks Back (#36). Escape hides
                  the name (WCAG 1.4.13). */}
              <DismissibleLink
                href={`#neighbour-${spot.neighbour}`}
                className={styles.pin}
              >
                <span className={styles.label}>
                  {NAMES.get(spot.neighbour)}
                </span>
              </DismissibleLink>
            </li>
          ))}
        </ul>
      </div>
      {/* The AI mark sits under the picture, not on it: every corner of the
          street has a neighbour, and on phones a corner mark covered the
          cow's ring. */}
      <figcaption className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-2 pt-3 pb-1 text-ink-muted">
        <span className="min-w-0">{t("caption")}</span>
        <AiMark className="ms-auto" />
      </figcaption>
    </figure>
  );
}
