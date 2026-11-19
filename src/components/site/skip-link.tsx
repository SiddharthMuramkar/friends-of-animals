"use client";

import type { ReactNode } from "react";

import { isModifiedClick } from "@/lib/in-page";

import { jumpTo } from "./in-page-link";

const MAIN_ID = "main";

/**
 * "Skip to main content". Moves focus to <main id="main"> without adding a
 * history entry: a pushed #main entry has no router state, so Back would
 * break (#36), and Quick exit couldn't replace it (#35). Without
 * JavaScript, the href still works.
 */
export function SkipLink({ children }: { children: ReactNode }) {
  return (
    <a
      href={`#${MAIN_ID}`}
      onClick={(e) => {
        if (e.defaultPrevented || isModifiedClick(e)) return;
        const main = document.getElementById(MAIN_ID);
        if (!main) return;
        e.preventDefault();
        jumpTo(main);
      }}
      className="sr-only rounded-full bg-primary px-5 py-3 font-semibold text-primary-fg focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50"
    >
      {children}
    </a>
  );
}
