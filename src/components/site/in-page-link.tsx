"use client";

import type { ComponentProps, SyntheticEvent } from "react";

import { hashTarget, isModifiedClick } from "@/lib/in-page";

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

const DISMISSIBLE = {
  "data-dismissible": "",
  onPointerEnter: show,
  onFocus: show,
};

/**
 * Scrolls to an in-page target and moves keyboard focus there. `scroll`
 * honours prefers-reduced-motion and scroll-padding-top (globals.css).
 */
export function jumpTo(target: HTMLElement, { scroll = true } = {}) {
  if (scroll) {
    const reduce = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;
    target.scrollIntoView({
      behavior: reduce ? "instant" : "smooth",
      block: "start",
    });
  }
  // Headings and sections aren't focusable by default.
  if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
  target.focus({ preventScroll: true });
}

/**
 * A link to a section on the same page ("On this page", jump chips).
 *
 * A plain `<a href="#id">` pushes a history entry without Next.js router
 * state, so Back then fails to re-render the previous page (#36), and on
 * /safeguarding it leaves an entry Quick exit can't replace (#35). With
 * JavaScript, this replaces the current entry instead (Next copies its state
 * across), scrolls and focuses the target. Without it, the href still works.
 */
export function InPageLink({
  href,
  onClick,
  dismissible,
  children,
  ...props
}: Omit<ComponentProps<"a">, "href"> & {
  href: `#${string}`;
  /**
   * For a link that shows more on hover or focus (a name beside a ring):
   * Escape sets `data-dismissed` on it, for CSS to hide that, until the
   * pointer comes back or it's focused again (WCAG 1.4.13). Uses
   * onPointerEnter and onFocus: don't pass your own.
   */
  dismissible?: boolean;
}) {
  return (
    <a
      {...(dismissible ? DISMISSIBLE : {})}
      {...props}
      href={href}
      onClick={(e) => {
        onClick?.(e);
        if (e.defaultPrevented || isModifiedClick(e)) return;
        const id = hashTarget(href);
        const target = id ? document.getElementById(id) : null;
        if (!target) return;
        e.preventDefault();
        window.history.replaceState(null, "", href);
        jumpTo(target);
      }}
    >
      {children}
    </a>
  );
}
