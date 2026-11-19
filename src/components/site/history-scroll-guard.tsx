"use client";

import { useEffect } from "react";

/**
 * Back and Forward restore the scroll position instantly.
 *
 * globals.css turns on `scroll-behavior: smooth`, and Next only switches it
 * off around push navigations. On a history traversal Chrome restores the
 * scroll itself and animates it, flying through the whole page (#36). This
 * switches smooth scrolling off from the popstate (capture, so before
 * Next's own listener) until the restore has happened.
 */
export function HistoryScrollGuard() {
  useEffect(() => {
    const html = document.documentElement;
    let frame = 0;
    const onPopState = () => {
      cancelAnimationFrame(frame);
      html.style.scrollBehavior = "auto";
      // Chrome restores in the next frame; give it one more to be safe.
      frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(() => {
          html.style.scrollBehavior = "";
        });
      });
    };
    window.addEventListener("popstate", onPopState, { capture: true });
    return () => {
      window.removeEventListener("popstate", onPopState, { capture: true });
      cancelAnimationFrame(frame);
      html.style.scrollBehavior = "";
    };
  }, []);
  return null;
}
