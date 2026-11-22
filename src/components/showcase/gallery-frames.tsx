import { Brush, Camera, PenLine, Scissors } from "lucide-react";
import { getTranslations } from "next-intl/server";
import type { ComponentType, SVGProps } from "react";

import { cn } from "@/lib/utils";

const FRAMES = [
  {
    key: "drawing",
    Icon: PenLine,
    corner: "bg-red-600",
    tilt: "-rotate-1",
    shape: "aspect-4/5",
  },
  {
    key: "painting",
    Icon: Brush,
    corner: "bg-green-500",
    tilt: "rotate-1",
    shape: "aspect-square",
  },
  {
    key: "photo",
    Icon: Camera,
    corner: "bg-blue-700",
    tilt: "rotate-[0.5deg]",
    shape: "aspect-4/5",
  },
  {
    key: "craft",
    Icon: Scissors,
    corner: "bg-yellow-300",
    tilt: "-rotate-[0.5deg]",
    shape: "aspect-square",
  },
] as const satisfies readonly {
  key: string;
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
  corner: string;
  tilt: string;
  shape: string;
}[];

/**
 * "The gallery that is waiting": empty frames with honest labels. No
 * artwork is shown until real, consented entries exist (owner decision 1).
 */
export async function GalleryFrames({ className }: { className?: string }) {
  const t = await getTranslations("home.gallery");
  return (
    <ul
      className={cn(
        "grid grid-cols-2 items-start gap-5 sm:gap-8 lg:grid-cols-4",
        className
      )}
    >
      {FRAMES.map(({ key, Icon, corner, tilt, shape }) => (
        <li key={key} className={cn("relative", tilt)}>
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
              <span className="flex min-w-0 flex-col items-center gap-2">
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
