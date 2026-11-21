"use client";

import { useEffect } from "react";

import { reportBoundaryError } from "@/lib/observability/boundary";

import messages from "../../messages/en-IN/error.json";

import "./globals.css";

const m = messages.error;

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
    reportBoundaryError(error);
  }, [error]);

  return (
    <html lang="en-IN">
      <body className="flex min-h-dvh items-center justify-center bg-background p-6 font-sans text-ink antialiased">
        <title>{m.pageTitle}</title>
        <main className="max-w-xl text-center">
          <h1 className="text-h2">{m.title}</h1>
          <p className="mt-4 text-ink-muted">{m.body}</p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <button
              type="button"
              onClick={() => retry()}
              className="inline-flex min-h-11 items-center justify-center rounded-full bg-primary px-5 font-semibold text-primary-fg hover:bg-primary-hover"
            >
              {m.retry}
            </button>
            {/* A full page load, since the app shell itself failed. */}
            {/* oxlint-disable-next-line nextjs/no-html-link-for-pages */}
            <a
              href="/"
              className="inline-flex min-h-11 items-center justify-center rounded-full border-2 border-border-strong px-5 font-semibold hover:border-ink"
            >
              {m.home}
            </a>
          </div>
        </main>
      </body>
    </html>
  );
}
