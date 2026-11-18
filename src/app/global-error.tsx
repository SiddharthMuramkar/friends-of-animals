"use client";

import { useEffect } from "react";

import { SITE } from "@/lib/site";

import "./globals.css";

// Replaces the root layout when the layout itself fails, so it renders its
// own <html> and <body> and can't rely on the header, fonts or theme script.
export default function GlobalError({
  error,
  retry,
}: {
  error: unknown;
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <body className="flex min-h-dvh items-center justify-center bg-background p-6 font-sans text-foreground antialiased">
        <title>{`Something went wrong | ${SITE.name}`}</title>
        <main className="max-w-xl text-center">
          <h1 className="text-3xl font-bold tracking-tight">
            Something went wrong
          </h1>
          <p className="mt-4 text-muted-foreground">
            {SITE.name} couldn&apos;t load this page. Please try again.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <button
              type="button"
              onClick={() => retry()}
              className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              Try again
            </button>
            {/* A full page load, since the app shell itself failed. */}
            {/* oxlint-disable-next-line nextjs/no-html-link-for-pages */}
            <a
              href="/"
              className="inline-flex h-10 items-center justify-center rounded-md border border-border px-4 text-sm font-medium hover:bg-accent"
            >
              Go to the home page
            </a>
          </div>
        </main>
      </body>
    </html>
  );
}
