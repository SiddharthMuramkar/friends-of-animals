import type { ReactNode } from "react";

import { Photo } from "@/components/site/photo";
import type { SiteImageId } from "@/lib/images";
import { cn } from "@/lib/utils";

/** One photo in a mosaic: a happy-set image and its short, translated note. */
export type HappyTile = {
  id: SiteImageId;
  /** Five words at most: it is handwritten on a note. */
  caption: string;
};

type Slot = {
  /** Crop by aspect; the photo's focal point keeps the animal in frame. */
  shape: string;
  /** Resting tilt of the print. Static, so it stays under reduced motion. */
  tilt: string;
  note: "yellow" | "pink" | "teal";
  frame?: "red" | "green" | "blue";
  corner?: "top-left" | "top-right";
  /** Grid placement and stagger. */
  place?: string;
  /** Rendered width at each breakpoint, for the srcset choice. */
  sizes: string;
};

type Layout = {
  /** Classes for the photo list. */
  grid: string;
  slots: readonly Slot[];
};

// Container maths (Section, max-w-7xl): 1232 px of content at 1280, 16 px
// gutters on phones, 24 px from sm.
const SIDE = "(min-width: 1280px) 346px, (min-width: 1024px) 27vw, 46vw";
const SIDE_WIDE = "(min-width: 1280px) 346px, (min-width: 1024px) 27vw, 82vw";
const CENTRE = "(min-width: 1280px) 218px, (min-width: 1024px) 17vw, 46vw";
const QUARTER = "(min-width: 1280px) 284px, (min-width: 1024px) 22vw, 46vw";

const LAYOUTS = {
  /**
   * Six prints round a centrepiece (the home joy band): a column of two on
   * each side, the centrepiece and a pair in the middle. Phones get the
   * centrepiece, two pairs, then the two landscapes as wide prints.
   */
  around: {
    grid: "",
    slots: [
      // Left column; on phones, the third row.
      {
        shape: "aspect-4/5",
        tilt: "-rotate-1",
        note: "yellow",
        frame: "red",
        corner: "top-left",
        sizes: SIDE,
      },
      // Left column; on phones, a wide print after the pairs.
      {
        shape: "aspect-4/3",
        tilt: "rotate-1",
        note: "teal",
        place: "order-1 max-lg:col-span-2 max-lg:w-[88%] lg:order-none",
        sizes: SIDE_WIDE,
      },
      // Centre pair, under the centrepiece.
      {
        shape: "aspect-square",
        tilt: "rotate-1",
        note: "pink",
        sizes: CENTRE,
      },
      {
        shape: "aspect-square",
        tilt: "-rotate-1",
        note: "yellow",
        frame: "green",
        corner: "top-right",
        place: "mt-10 lg:mt-8",
        sizes: CENTRE,
      },
      // Right column, set lower than the left; on phones, the last print.
      {
        shape: "aspect-4/3",
        tilt: "rotate-[0.6deg]",
        note: "pink",
        place:
          "order-2 max-lg:col-span-2 max-lg:w-[88%] max-lg:justify-self-end lg:order-none",
        sizes: SIDE_WIDE,
      },
      {
        shape: "aspect-4/5",
        tilt: "-rotate-[0.8deg]",
        note: "teal",
        frame: "blue",
        corner: "top-right",
        place: "mt-10 lg:mt-0",
        sizes: SIDE,
      },
    ],
  },
  /** Four prompts in a row, staggered; two by two on phones. */
  row4: {
    grid: "grid grid-cols-2 items-start gap-x-4 gap-y-8 sm:gap-x-6 lg:grid-cols-4 lg:gap-x-8",
    slots: [
      {
        shape: "aspect-4/5",
        tilt: "-rotate-1",
        note: "yellow",
        frame: "red",
        corner: "top-left",
        sizes: QUARTER,
      },
      {
        shape: "aspect-4/5",
        tilt: "rotate-1",
        note: "pink",
        place: "mt-10",
        sizes: QUARTER,
      },
      {
        shape: "aspect-4/5",
        tilt: "rotate-[0.6deg]",
        note: "teal",
        frame: "blue",
        corner: "top-right",
        place: "lg:mt-4",
        sizes: QUARTER,
      },
      {
        shape: "aspect-4/5",
        tilt: "-rotate-[0.8deg]",
        note: "yellow",
        place: "mt-10 lg:mt-12",
        sizes: QUARTER,
      },
    ],
  },
  /** Three prints: a wide one, then two; in one row from sm. */
  row3: {
    grid: "grid grid-cols-2 items-start gap-x-4 gap-y-8 sm:grid-cols-[minmax(0,5fr)_minmax(0,4fr)_minmax(0,4fr)] sm:gap-x-6 lg:gap-x-8",
    slots: [
      {
        shape: "aspect-4/3",
        tilt: "-rotate-1",
        note: "yellow",
        frame: "green",
        corner: "top-left",
        place: "col-span-2 sm:col-span-1",
        sizes: "(min-width: 1280px) 448px, (min-width: 640px) 36vw, 92vw",
      },
      {
        shape: "aspect-4/5",
        tilt: "rotate-1",
        note: "pink",
        place: "sm:mt-10",
        sizes: "(min-width: 1280px) 358px, (min-width: 640px) 29vw, 46vw",
      },
      {
        shape: "aspect-4/5",
        tilt: "-rotate-[0.6deg]",
        note: "teal",
        frame: "blue",
        corner: "top-right",
        place: "mt-10 sm:mt-4",
        sizes: "(min-width: 1280px) 358px, (min-width: 640px) 29vw, 46vw",
      },
    ],
  },
  /** Two prints side by side, the second set lower. */
  pair: {
    grid: "grid grid-cols-2 items-start gap-x-4 sm:gap-x-6",
    slots: [
      {
        shape: "aspect-4/5",
        tilt: "-rotate-1",
        note: "yellow",
        frame: "green",
        corner: "top-left",
        sizes: "(min-width: 1280px) 232px, (min-width: 1024px) 18vw, 46vw",
      },
      {
        shape: "aspect-4/5",
        tilt: "rotate-1",
        note: "pink",
        frame: "blue",
        corner: "top-right",
        place: "mt-10",
        sizes: "(min-width: 1280px) 232px, (min-width: 1024px) 18vw, 46vw",
      },
    ],
  },
} as const satisfies Record<string, Layout>;

// Lift 2 px and straighten on hover or keyboard focus (the credit link);
// nothing moves under reduced motion.
const LIFT =
  "transition-[translate,rotate] duration-200 ease-out motion-safe:hover:-translate-y-0.5 motion-safe:hover:rotate-0 motion-safe:focus-within:-translate-y-0.5 motion-safe:focus-within:rotate-0";

function Print({
  tile,
  slot,
  as: Tag = "li",
}: {
  tile: HappyTile;
  slot: Slot;
  as?: "li" | "div";
}) {
  return (
    <Tag className={cn(LIFT, slot.tilt, slot.place)}>
      <Photo
        id={tile.id}
        sizes={slot.sizes}
        frame={slot.frame}
        frameCorner={slot.corner}
        caption={tile.caption}
        captionNote={slot.note}
        className={cn("shadow-warm ring-4 ring-surface sm:ring-6", slot.shape)}
      />
    </Tag>
  );
}

/**
 * Happy dogs and cats as tile-framed prints: an asymmetric grid with
 * handwritten notes and the real place under each photo. Server-only, lazy
 * images (never preloaded), CSS-only hover. `children` is the centrepiece of
 * the "around" layout (a heading and a quote).
 */
export function HappyMosaic({
  layout,
  tiles,
  label,
  children,
  className,
}: {
  layout: keyof typeof LAYOUTS;
  tiles: readonly HappyTile[];
  /** Accessible name for the photo list (row and pair layouts). */
  label?: string;
  children?: ReactNode;
  className?: string;
}) {
  const { grid, slots } = LAYOUTS[layout];
  if (tiles.length !== slots.length) {
    throw new Error(
      `HappyMosaic "${layout}" takes ${slots.length} photos, got ${tiles.length}`
    );
  }

  if (layout !== "around") {
    return (
      <ul aria-label={label} className={cn(grid, className)}>
        {tiles.map((tile, i) => (
          <Print key={tile.id} tile={tile} slot={slots[i]!} />
        ))}
      </ul>
    );
  }

  // Figures in three groups (not lists): the section heading names them.
  // Below lg the groups dissolve (display: contents) into one two-column
  // grid; the two wide prints move to the end with `order`.
  const prints = tiles.map((tile, i) => (
    <Print key={tile.id} tile={tile} slot={slots[i]!} as="div" />
  ));
  const COLUMN = "contents lg:grid lg:items-start lg:gap-y-12";
  return (
    <div
      className={cn(
        "grid grid-cols-2 items-start gap-x-4 gap-y-12 sm:gap-x-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,4fr)_minmax(0,3fr)] lg:gap-x-10",
        className
      )}
    >
      <div className="contents lg:col-start-2 lg:row-start-1 lg:block">
        <div className="col-span-2">{children}</div>
        <div className={cn(COLUMN, "lg:mt-12 lg:grid-cols-2 lg:gap-x-6")}>
          {prints.slice(2, 4)}
        </div>
      </div>
      <div className={cn(COLUMN, "lg:col-start-1 lg:row-start-1 lg:pt-4")}>
        {prints.slice(0, 2)}
      </div>
      <div className={cn(COLUMN, "lg:col-start-3 lg:row-start-1 lg:pt-20")}>
        {prints.slice(4, 6)}
      </div>
    </div>
  );
}
