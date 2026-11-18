import Link from "next/link";

import { ThemeToggle } from "@/components/theme-toggle";
import { SITE } from "@/lib/site";

export function SiteHeader() {
  return (
    <header className="border-b border-border">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
        {/* The registered logo, unaltered (see public/brand/README.md). In
            dark mode it sits on a white plate so the black wordmark stays
            legible. */}
        <Link
          href="/"
          className="shrink-0 rounded-md focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none dark:bg-white dark:p-1.5"
        >
          {/* oxlint-disable-next-line nextjs/no-img-element -- SVG master, nothing to optimise */}
          <img
            src={SITE.logo.src}
            alt={`${SITE.name} home`}
            width={SITE.logo.width}
            height={SITE.logo.height}
            className="h-12 w-auto sm:h-14"
          />
        </Link>
        <ThemeToggle />
      </div>
    </header>
  );
}
