"use client";

import type { ComponentProps, SyntheticEvent } from "react";

import { InPageLink } from "@/components/site/in-page-link";

/**
 * Escape marks the hovered or focused dismissible link `data-dismissed`. On
 * the document: a hovered link isn't the focused one, so its own keydown
 * never fires.
 */
function dismiss(e: KeyboardEvent) {
  if (e.key !== "Escape") return;
  for (const link of document.querySelectorAll<HTMLElement>(
    "[data-dismissible]:is(:hover, :focus)"
  )) {
    link.dataset.dismissed = "";
  }
}

/**
 * Hovering or focusing the link again shows it again. Adds the listener on
 * first use (adding the same one twice does nothing).
 */
function show(e: SyntheticEvent<HTMLElement>) {
  document.addEventListener("keydown", dismiss);
  delete e.currentTarget.dataset.dismissed;
}

/**
 * An InPageLink that shows more on hover or focus (a name beside a ring):
 * Escape sets `data-dismissed` on it, for CSS to hide that, until the
 * pointer comes back or it's focused again (WCAG 1.4.13). Its own module, so
 * only the street scene's page pays for it, not every page that shares
 * InPageLink's chunk.
 */
export function DismissibleLink(props: ComponentProps<typeof InPageLink>) {
  return (
    <InPageLink
      data-dismissible=""
      onPointerEnter={show}
      onFocus={show}
      {...props}
    />
  );
}
