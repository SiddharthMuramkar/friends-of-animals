import { getImageProps } from "next/image";
import type { CSSProperties } from "react";

import { type SiteArtId, siteArt } from "@/lib/art";
import { cn } from "@/lib/utils";

import { AiMark } from "./ai-mark";
import { MARK_POSITION } from "./illustration";
import styles from "./living.module.css";

const TRIGGER = {
  /** Wakes over the first 40% of a screen of page scroll. */
  page: styles.page,
  /** Wakes as it rises in from the bottom of the screen. */
  view: styles.view,
  /**
   * Wakes as it rises in, done once it is wholly on screen: finishes even as
   * the last thing on the page (the footer).
   */
  arrive: styles.arrive,
  /** Wakes as it scrolls to the middle of the screen. */
  middle: styles.middle,
} as const;

// Image props for a strip that wakes (a constant: the lint rule bars
// literals here).
const AS_MADE = { unoptimized: true } as const;
const LOW = "low" as const;

type Props = {
  id: SiteArtId;
  /** Treat as decoration even when the registry gives alt text. */
  decorative?: boolean;
  /** Where the "AI illustration" tag sits on a meaningful one. */
  mark?: keyof typeof MARK_POSITION | false;
  /** Size and position; the height follows one frame's aspect ratio. */
  className?: string;
} & (
  | { trigger: keyof typeof TRIGGER; still?: never }
  | {
      trigger?: never;
      /**
       * Never wakes: rests on its last frame, e.g. a thumbnail. The frame's
       * rendered width in CSS pixels (className sets it), so the optimizer
       * can serve a strip that size.
       */
      still: number;
    }
);

/**
 * A living illustration (GLOSSARY): an animal drawn from a short AI video
 * that wakes up as you scroll. Still (on its last, awake frame) under reduced
 * motion and in browsers without scroll-driven animations. Adds no
 * JavaScript.
 *
 * Decorative ones are hidden from screen readers. A meaningful one (the
 * registry gives it alt text) is one image to assistive technology: the strip
 * carries that alt text, and the AI mark beside it is visual only.
 *
 * A strip that wakes ships as made (unoptimized): the optimizer would resize
 * it by viewport width, which means nothing for a strip of frames. A still
 * one is optimized to its rendered size, the whole strip at `still` pixels a
 * frame. Either loads lazily and at low priority, so it never competes with a
 * page's main photo (the home hero, its LCP image).
 *
 * A plain <img> built on the server with getImageProps (the same markup
 * next/image renders), so the footer cat brings no image script to pages
 * that have no photo.
 */
export function LivingIllustration({
  id,
  trigger,
  still,
  decorative,
  mark = "bottom-right",
  className,
}: Props) {
  // No blur placeholder, so the blur-free file: it rides in the RSC payload.
  const { plain, entry } = siteArt(id);
  const frames = entry.frames ?? 1;
  const isDecorative = decorative ?? entry.decorative;
  const style = {
    "--frames": frames,
    aspectRatio: `${entry.width} / ${entry.height}`,
  } as CSSProperties;
  const { props } = getImageProps({
    src: plain,
    alt: isDecorative ? "" : (entry.alt ?? ""),
    ...(still === undefined ? AS_MADE : { sizes: `${frames * still}px` }),
    fetchPriority: LOW,
  });
  const strip = (
    <span
      aria-hidden={isDecorative ? "true" : undefined}
      className={cn(
        styles.frame,
        trigger && TRIGGER[trigger],
        isDecorative && className
      )}
      style={style}
    >
      {/* oxlint-disable-next-line nextjs/no-img-element -- server-built with getImageProps: next/image's markup without its client script */}
      <img
        {...props}
        alt={props.alt}
        draggable={false}
        className={styles.strip}
      />
    </span>
  );
  if (isDecorative) return strip;
  return (
    <span className={cn("relative block", className)}>
      {strip}
      {mark === false ? null : <AiMark className={MARK_POSITION[mark]} />}
    </span>
  );
}
