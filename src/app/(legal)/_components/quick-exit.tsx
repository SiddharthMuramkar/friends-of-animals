"use client";

import { LogOut } from "lucide-react";
import { useEffect } from "react";

/** Neutral page to land on (GOV.UK "Exit this page" pattern, ux-patterns P06). */
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
 * "Quick exit": leaves for a neutral site at once. Works as a plain link
 * without JavaScript; with it, the page is hidden and replaced in history,
 * and Esc does the same (unless a popover or dialog is open to close first).
 */
export function QuickExit({
  label,
  hintId,
}: {
  label: string;
  /** id of the visible hint that explains the button and the Esc key. */
  hintId: string;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (somethingOpen()) return;
      leave();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return (
    <a
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
