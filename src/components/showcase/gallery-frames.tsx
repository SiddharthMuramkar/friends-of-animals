import { Brush, Camera, PenLine, Scissors } from "lucide-react";
import { getTranslations } from "next-intl/server";
import type { ComponentType, SVGProps } from "react";

import { AiMark } from "@/components/art/ai-mark";
import { Illustration } from "@/components/art/illustration";
import type { SiteArtId } from "@/lib/art";
import { cn } from "@/lib/utils";

/**
 * A neighbour waiting by an empty frame, behind its top edge. Sized in px,
 * so enlarged text never widens it past a phone's screen.
 */
type Visitor = {
  id: SiteArtId;
  /** The stretch above the frame it sits in, at its right-hand end. */
  perch: string;
  /** Width, and how far it sinks behind the frame's top edge. */
  className: string;
  sizes: string;
  /**
   * Shows the AI mark beside it (ADR 0003): a cat peeking over "A painting
   * of your street's cat?" could pass for the painting.
   */
  mark: boolean;
};

const FRAMES = [
  {
    key: "drawing",
    Icon: PenLine,
    corner: "bg-red-600",
    tilt: "-rotate-1",
    shape: "aspect-4/5",
    visitor: null,
  },
  {
    key: "painting",
    Icon: Brush,
    corner: "bg-green-500",
    tilt: "rotate-1",
    shape: "aspect-square",
    // Head and paws over the edge, 12% in from its left; its straight lower
    // edge hides behind it. The perch runs back over the column to its left,
    // so the mark sits beside it, or above it where that is too narrow.
    visitor: {
      id: "gallery-cat",
      perch: "-left-full right-[calc(88%-64px)] sm:right-[calc(88%-80px)]",
      className: "w-[64px] translate-y-1 sm:w-[80px]",
      sizes: "(min-width: 640px) 80px, 64px",
      mark: true,
    },
  },
  {
    key: "photo",
    Icon: Camera,
    corner: "bg-blue-700",
    tilt: "rotate-[0.5deg]",
    shape: "aspect-4/5",
    visitor: null,
  },
  {
    key: "craft",
    Icon: Scissors,
    corner: "bg-yellow-300",
    tilt: "-rotate-[0.5deg]",
    shape: "aspect-square",
    // Its perch (63–70% down the drawing) slips behind the frame's top
    // edge, so its feet rest on the frame; the tail hangs behind it.
    visitor: {
      id: "gallery-crow",
      perch: "right-[18%]",
      className: "w-[48px] translate-y-[36%] sm:w-[56px]",
      sizes: "(min-width: 640px) 56px, 48px",
      mark: false,
    },
  },
] as const satisfies readonly {
  key: string;
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
  corner: string;
  tilt: string;
  shape: string;
  visitor: Visitor | null;
}[];

/**
 * "The gallery that is waiting": empty frames with honest labels. No
 * artwork is shown until real, consented entries exist (owner decision 1).
 * A cat and a crow (decorative AI illustrations) wait by two of them; the
 * frames themselves stay empty. The list's top padding keeps the cat's room
 * above the first row, clear of the words before it; on phones, where the
 * labels fill the frames, the taller row gap keeps the crow's.
 */
export async function GalleryFrames({ className }: { className?: string }) {
  const t = await getTranslations("home.gallery");
  return (
    <ul
      className={cn(
        "grid grid-cols-2 items-start gap-x-5 gap-y-14 pt-12 sm:gap-8 sm:pt-14 lg:grid-cols-4",
        className
      )}
    >
      {FRAMES.map(({ key, Icon, corner, tilt, shape, visitor }) => (
        <li key={key} className={cn("relative", tilt)}>
          {/* Behind the frame: the tilt makes this item a stacking
              context, so -z-10 stays above the section's background. The
              mark comes after the drawing in a reversed row, so it sits to
              its left, and wraps above it when the row is too narrow. */}
          {visitor ? (
            <span
              className={cn(
                "pointer-events-none absolute bottom-full -z-10 flex flex-row-reverse flex-wrap-reverse items-center gap-x-1.5 gap-y-1",
                visitor.perch
              )}
            >
              <Illustration
                id={visitor.id}
                sizes={visitor.sizes}
                decorative
                className={cn("shrink-0", visitor.className)}
              />
              {visitor.mark ? <AiMark /> : null}
            </span>
          ) : null}
          <div className="rounded-xl bg-surface p-2.5 shadow-warm ring-1 ring-border sm:p-3.5">
            {/* No overflow-hidden: the aspect ratio is then only a minimum
                height, so the frame grows to fit a long or spaced label. */}
            <div
              className={cn(
                "relative grid grid-cols-1 place-items-center rounded-md border-2 border-dashed border-border-strong bg-background p-[min(0.75rem,10%)] text-center",
                shape
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "absolute top-0 right-0 size-6 rounded-tr-[calc(var(--radius-md)-2px)] rounded-bl-[30%] sm:size-8",
                  corner
                )}
              />
              <span className="flex w-full min-w-0 flex-col items-center gap-2">
                <Icon aria-hidden="true" className="size-7 text-ink-muted" />
                <span className="max-w-full font-hand text-lead leading-snug text-ink">
                  {t(`frames.${key}`)}
                </span>
              </span>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
