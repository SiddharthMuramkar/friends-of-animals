"use client";

import { Moon, Sun } from "lucide-react";
import { useEffect, useSyncExternalStore } from "react";

import { setTheme, syncThemeColor } from "@/lib/theme";

// The `dark` class on <html> is the source of truth. The inline script in
// the root layout sets it before first paint; this toggle flips it.
function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  });
  return () => observer.disconnect();
}

const isDark = () => document.documentElement.classList.contains("dark");
const isDarkOnServer = () => false;

/** Labels arrive translated from the server (no i18n code in the browser). */
export function ThemeToggle({
  labels,
}: {
  labels: { toDark: string; toLight: string };
}) {
  const dark = useSyncExternalStore(subscribe, isDark, isDarkOnServer);

  // Keep every theme-color meta in step with the class once hydrated: the
  // head script adds a dark one ahead of the layout's light one.
  useEffect(() => syncThemeColor(isDark()), [dark]);

  return (
    <button
      type="button"
      onClick={() => setTheme(!dark)}
      className="inline-flex size-11 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink"
      aria-label={dark ? labels.toLight : labels.toDark}
    >
      {dark ? (
        <Sun aria-hidden="true" className="size-5" />
      ) : (
        <Moon aria-hidden="true" className="size-5" />
      )}
    </button>
  );
}
