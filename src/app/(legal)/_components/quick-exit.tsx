"use client";

import { LogOut } from "lucide-react";
import { useEffect, useRef } from "react";

import { scrollToClear } from "@/lib/in-page";

/** Neutral page to land on (GOV.UK "Exit this page" pattern). */
const DESTINATION = "https://www.google.com/search?q=weather";

function leave() {
  document.body.style.visibility = "hidden";
  // replace(): the Back button won't return here.
  window.location.replace(DESTINATION);
}

/** A popover or dialog is open: Esc should close that first. */
function somethingOpen() {
  try {
    return document.querySelector(":popover-open, dialog[open]") !== null;
  } catch {
    return document.querySelector("dialog[open]") !== null;
  }
}

/**
 * Publishes the sticky bar's height as --quick-exit-height on <html>, for
 * scroll-padding-top and the sticky table of contents (globals.css). The bar
 * wraps onto two lines on narrow tablets and grows with the text size.
 * data-quick-exit says whether it's shown: after a client-side navigation
 * away, Next keeps the bar in the DOM, hidden, and unmounts this effect.
 */
function trackHeight(bar: HTMLElement) {
  const html = document.documentElement;
  html.dataset.quickExit = "shown";
  const observer = new ResizeObserver(([entry]) => {
    const height = entry?.borderBoxSize?.[0]?.blockSize ?? bar.offsetHeight;
    html.style.setProperty("--quick-exit-height", `${height}px`);
  });
  observer.observe(bar);
  return () => {
    observer.disconnect();
    html.style.removeProperty("--quick-exit-height");
    html.dataset.quickExit = "hidden";
  };
}

/**
 * Safari doesn't always honour scroll-padding when Tab or Shift+Tab scrolls
 * a link into view, so a focused link can land behind the bar (#48). Nudge
 * it clear. Jump targets (tabindex -1) are scrolled by InPageLink instead.
 */
function keepFocusClear(bar: HTMLElement) {
  const onFocusIn = (e: FocusEvent) => {
    const el = e.target;
    // Only page content scrolls under the bar; the header sits above it.
    if (!(el instanceof HTMLElement) || el.tabIndex < 0) return;
    if (!el.closest("main, footer")) return;
    requestAnimationFrame(() => {
      if (document.activeElement !== el || !el.matches(":focus-visible"))
        return;
      const rem = parseFloat(
        getComputedStyle(document.documentElement).fontSize
      );
      const top = scrollToClear(
        el.getBoundingClientRect().top,
        bar.getBoundingClientRect().bottom,
        rem
      );
      if (top !== 0) window.scrollBy({ top, behavior: "instant" });
    });
  };
  document.addEventListener("focusin", onFocusIn);
  return () => document.removeEventListener("focusin", onFocusIn);
}

/**
 * "Quick exit": leaves for a neutral site at once. Works as a plain link
 * without JavaScript; with it, the page is hidden and replaced in history,
 * and Esc does the same (unless a popover or dialog is open to close first).
 * Render it inside the sticky bar marked `data-quick-exit-bar`.
 */
export function QuickExit({
  label,
  hintId,
}: {
  label: string;
  /** id of the visible hint that explains the button and the Esc key. */
  hintId: string;
}) {
  const ref = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (somethingOpen()) return;
      leave();
    };
    document.addEventListener("keydown", onKey);
    const bar = ref.current?.closest<HTMLElement>("[data-quick-exit-bar]");
    const untrack = bar ? trackHeight(bar) : undefined;
    const unfocus = bar ? keepFocusClear(bar) : undefined;
    return () => {
      document.removeEventListener("keydown", onKey);
      untrack?.();
      unfocus?.();
    };
  }, []);

  return (
    <a
      ref={ref}
      href={DESTINATION}
      rel="nofollow noreferrer"
      aria-describedby={hintId}
      onClick={(e) => {
        e.preventDefault();
        leave();
      }}
      className="inline-flex min-h-11 items-center gap-2 rounded-full border-2 border-red-800 bg-red-700 px-5 font-semibold text-white shadow-warm hover:bg-red-800 focus-visible:outline-offset-4 [&_svg]:size-5"
    >
      <LogOut aria-hidden="true" />
      {label}
    </a>
  );
}
