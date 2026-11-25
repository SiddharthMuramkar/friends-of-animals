"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** The route is uncached and rechecks auction consent on each refresh.
 * No bidder data or public API exposing ids; only the visible route is
 * re-rendered. Refresh leaves the focused form and typed amount intact. */
export function LiveLotRefresh() {
  const router = useRouter();
  useEffect(() => {
    const refresh = () => {
      if (!document.hidden) router.refresh();
    };
    const timer = window.setInterval(refresh, 5000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [router]);
  return null;
}
