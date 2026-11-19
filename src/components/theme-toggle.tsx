"use client";

import { Moon, Sun } from "lucide-react";
import { useEffect, useSyncExternalStore } from "react";

import { setTheme, syncThemeColor } from "@/lib/theme";
import { cn } from "@/lib/utils";

// The `dark` class on <html> is the source of truth. The inline script in
// the root layout sets it before first paint; these controls flip it.
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

/**
 * The header's theme button: an icon with a visible label ("Dark" or
 * "Light"). Both states are in the markup and the `dark` class picks one,
 * so the label is right before hydration. Labels arrive translated from the
 * server (no i18n code in the browser).
 */
export function ThemeToggle({
  labels,
  className,
}: {
  labels: { toDark: string; toLight: string; dark: string; light: string };
  className?: string;
}) {
  // Once hydrated, bring every theme-color meta in line with the class: the
  // head script adds a dark one ahead of the layout's light one.
  useEffect(() => syncThemeColor(isDark()), []);

  return (
    <button
      type="button"
      onClick={() => setTheme(!isDark())}
      className={cn(
        "inline-flex min-h-11 min-w-11 items-center justify-center rounded-full px-3 font-semibold text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink",
        className
      )}
    >
      <span className="inline-flex items-center gap-2 dark:hidden">
        <Moon aria-hidden="true" className="size-5" />
        <span aria-hidden="true">{labels.dark}</span>
        <span className="sr-only">{labels.toDark}</span>
      </span>
      <span className="hidden items-center gap-2 dark:inline-flex">
        <Sun aria-hidden="true" className="size-5" />
        <span aria-hidden="true">{labels.light}</span>
        <span className="sr-only">{labels.toLight}</span>
      </span>
    </button>
  );
}

/**
 * The theme control in the phone menu: a labelled on/off switch for the
 * dark theme. The track follows the `dark` class, so it is right before
 * hydration; aria-checked follows once hydrated.
 */
export function ThemeSwitch({
  label,
  className,
}: {
  label: string;
  className?: string;
}) {
  const dark = useSyncExternalStore(subscribe, isDark, isDarkOnServer);

  return (
    <button
      type="button"
      role="switch"
      aria-checked={dark}
      onClick={() => setTheme(!dark)}
      className={cn(
        "flex min-h-12 w-full items-center justify-between gap-4 rounded-2xl px-4 text-lead font-semibold hover:bg-surface-muted",
        className
      )}
    >
      <span className="inline-flex items-center gap-3">
        <Moon aria-hidden="true" className="size-5 shrink-0" />
        {label}
      </span>
      <span
        aria-hidden="true"
        className="flex h-7 w-12 shrink-0 items-center rounded-full border-2 border-border-strong p-0.5 dark:border-primary dark:bg-primary"
      >
        <span className="size-5 rounded-full bg-ink-muted motion-safe:transition-[translate] dark:translate-x-5 dark:bg-primary-fg" />
      </span>
    </button>
  );
}
