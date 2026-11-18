"use client";

import { Moon, Sun } from "lucide-react";
import { useSyncExternalStore } from "react";

import { THEME_STORAGE_KEY } from "@/lib/theme";

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

export function ThemeToggle() {
  const dark = useSyncExternalStore(subscribe, isDark, isDarkOnServer);

  function toggle() {
    const next = !dark;
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next ? "dark" : "light");
    } catch {
      // Storage can be unavailable (private mode); the toggle still works.
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      className="inline-flex size-10 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
    >
      {dark ? (
        <Sun aria-hidden="true" className="size-5" />
      ) : (
        <Moon aria-hidden="true" className="size-5" />
      )}
    </button>
  );
}
