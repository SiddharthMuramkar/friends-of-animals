import Link from "next/link";

import { Logo } from "@/components/logo";
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
          {/* Decorative: the name beside it labels the link. */}
          <Logo wrapperClassName="shrink-0" className="h-12 w-auto sm:h-14" />
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
