"use client";

import { useEffect, useRef } from "react";

// Large text can wrap the header far past the --header-height default in
// globals.css, which breaks sticky offsets and scroll-padding. Track the real
// height on <html>; the CSS default stays as the pre-hydration fallback.
export function HeaderHeightSync() {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const header = ref.current?.closest("header");
    if (!header) return;
    const root = document.documentElement;
    const observer = new ResizeObserver(([entry]) => {
      const height = entry?.borderBoxSize[0]?.blockSize ?? header.offsetHeight;
      root.style.setProperty("--header-height", `${height}px`);
    });
    observer.observe(header);
    return () => {
      observer.disconnect();
      root.style.removeProperty("--header-height");
    };
  }, []);

  return <span ref={ref} hidden />;
}
