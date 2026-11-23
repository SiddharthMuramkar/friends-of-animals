import { getImageProps } from "next/image";

import { type SiteArtId, siteArt } from "@/lib/art";
import { cn } from "@/lib/utils";

import { AiMark } from "./ai-mark";
import styles from "./art.module.css";

// Line art keeps its ink edges crisper at the higher allowed quality.
const QUALITY = 85;

export const MARK_POSITION = {
  "bottom-right": "absolute -right-1 -bottom-2",
  "bottom-left": "absolute -left-1 -bottom-2",
  "top-right": "absolute -top-2 -right-1",
  below: "mt-1 self-end",
} as const;

type Props = {
  id: SiteArtId;
  /** Required: how wide the drawing renders, e.g. "(min-width: 1024px) 240px, 40vw". */
  sizes: string;
  /**
   * Show as decoration (alt="" and no AI mark) even when the registry gives
   * alt text: for a drawing beside words that already say the same thing.
   */
  decorative?: boolean;
  /** Where the "AI illustration" tag sits; meaningful drawings only. */
  mark?: keyof typeof MARK_POSITION | false;
  /** Pop in as it scrolls into view (motion allowed, supporting browsers). */
  pop?: boolean;
  /** Classes for the wrapper (size, position, rotation). */
  className?: string;
  /** Classes for the image itself. */
  imgClassName?: string;
};

/**
 * One of FOA's AI illustrations (src/assets/site-art): an optimized, lazy
 * image with the registry's alt text, and the AI mark on meaningful art. A
 * plain <img> built on the server with getImageProps (the same markup
 * next/image renders), so a drawing brings no image script to a page.
 */
export function Illustration({
  id,
  sizes,
  decorative,
  mark = "bottom-right",
  pop = false,
  className,
  imgClassName,
}: Props) {
  // No blur placeholder, so the blur-free file: it rides in the RSC payload.
  const { plain, entry } = siteArt(id);
  const isDecorative = decorative ?? entry.decorative;
  const showMark = !isDecorative && mark !== false;
  const { props } = getImageProps({
    src: plain,
    alt: isDecorative ? "" : (entry.alt ?? ""),
    sizes,
    quality: QUALITY,
  });
  return (
    <span
      className={cn(
        "relative block",
        mark === "below" && showMark && "flex flex-col",
        pop && styles.pop,
        className
      )}
    >
      {/* oxlint-disable-next-line nextjs/no-img-element -- server-built with getImageProps: next/image's markup without its client script */}
      <img
        {...props}
        alt={props.alt}
        draggable={false}
        className={cn("block h-auto w-full select-none", imgClassName)}
      />
      {showMark ? <AiMark className={MARK_POSITION[mark]} /> : null}
    </span>
  );
}
