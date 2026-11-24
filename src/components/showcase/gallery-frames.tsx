import { getTranslations } from "next-intl/server";

import { Illustration } from "@/components/art/illustration";
import type { SiteArtId } from "@/lib/art";
import { cn } from "@/lib/utils";

const FRAMES = [
  {
    key: "drawing",
    illustration: "gallery-drawing",
    corner: "bg-red-600",
    tilt: "-rotate-1",
    shape: "lg:aspect-4/5",
  },
  {
    key: "painting",
    illustration: "gallery-painting",
    corner: "bg-green-500",
    tilt: "rotate-1",
    shape: "lg:aspect-square",
  },
  {
    key: "photo",
    illustration: "gallery-photo",
    corner: "bg-blue-700",
    tilt: "rotate-[0.5deg]",
    shape: "lg:aspect-4/5",
  },
  {
    key: "craft",
    illustration: "gallery-craft",
    corner: "bg-yellow-300",
    tilt: "-rotate-[0.5deg]",
    shape: "lg:aspect-square",
  },
] as const satisfies readonly {
  key: string;
  illustration: SiteArtId;
  corner: string;
  tilt: string;
  shape: string;
}[];

export async function GalleryFrames({ className }: { className?: string }) {
  const t = await getTranslations("home.gallery");
  return (
    <ul
      className={cn(
        "grid grid-cols-1 items-start gap-4 min-[24rem]:grid-cols-2 sm:gap-8 lg:grid-cols-4",
        className
      )}
    >
      {FRAMES.map(({ key, illustration, corner, tilt, shape }) => (
        <li
          key={key}
          className={cn(
            "rounded-xl bg-surface p-2.5 shadow-warm ring-1 ring-border sm:p-3.5",
            tilt
          )}
        >
          <figure
            className={cn(
              "relative flex flex-col items-center justify-center gap-3 rounded-md border-2 border-dashed border-border-strong bg-background px-2 pt-6 pb-3 text-center sm:px-3 sm:pt-8 sm:pb-4",
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
            <Illustration
              id={illustration}
              sizes="(min-width: 1024px) min(20vw, 224px), (min-width: 384px) min(40vw, 224px), 224px"
              mark="below"
              className="w-full min-w-0 max-w-56"
              imgClassName="aspect-4/3 object-contain"
            />
            <figcaption className="font-hand text-lead leading-snug wrap-anywhere text-ink">
              {t(`frames.${key}`)}
            </figcaption>
          </figure>
        </li>
      ))}
    </ul>
  );
}
