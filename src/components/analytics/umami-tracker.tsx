"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

import { startAnalytics } from "@/lib/analytics/tracker-island";
import type { UmamiConfig } from "@/lib/analytics/umami";

/**
 * Runs the analytics page checks after every page change, and appends
 * Umami's tracker the first time a page may load it. Renders nothing.
 *
 * A script appended by a bundled script passes both CSPs: 'self' on
 * public pages and 'strict-dynamic' on signed-in ones (where it never
 * loads anyway). A <script src> in the static root layout would be
 * blocked on signed-in pages, which need a nonce.
 */
export function UmamiTracker({ config }: { config: UmamiConfig }) {
  const pathname = usePathname();
  useEffect(() => {
    const tag = startAnalytics(window, config, Date.now());
    if (tag === null) return;
    const script = document.createElement("script");
    script.src = tag.src;
    Object.assign(script.dataset, tag.dataset);
    document.head.append(script);
  }, [config, pathname]);
  return null;
}
