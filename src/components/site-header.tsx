import Link from "next/link";

import { ThemeToggle } from "@/components/theme-toggle";
import { SITE } from "@/lib/site";

export function SiteHeader() {
  return (
    <header className="border-b border-border">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <Link
          href="/"
          className="flex min-w-0 items-center gap-3 rounded-md focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          {/* The registered logo, unaltered (see public/brand/README.md). In
              dark mode it sits on a white plate so the black wordmark stays
              legible. Decorative: the name beside it labels the link. */}
          <span className="shrink-0 rounded-md dark:bg-white dark:p-1.5">
            {/* oxlint-disable-next-line nextjs/no-img-element -- SVG master, nothing to optimise */}
            <img
              src={SITE.logo.src}
              alt=""
              width={SITE.logo.width}
              height={SITE.logo.height}
              className="block h-12 w-auto sm:h-14"
            />
          </span>
          {/* Shown from the sm breakpoint up. On narrow screens it stays in
              the accessibility tree, so the link always has a name. */}
          <span className="sr-only text-lg font-semibold tracking-tight sm:not-sr-only">
            {SITE.name}
          </span>
        </Link>
        <ThemeToggle />
      </div>
    </header>
  );
}
