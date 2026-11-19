"use client";

import { SiteLink } from "@/components/site/site-link";
import { useEffect } from "react";

import { buttonStyles } from "@/components/site/button-link";

// Client component: strings come from the message file directly (no next-intl
// client runtime on every page).
import messages from "../../messages/en-IN/error.json";

const m = messages.error;

export default function ErrorPage({
  error,
  retry,
}: {
  error: unknown;
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  // Server errors reach the browser without their message in production;
  // the digest matches the server log entry.
  const digest =
    error instanceof Error &&
    "digest" in error &&
    typeof error.digest === "string"
      ? error.digest
      : undefined;

  return (
    <section className="bg-section-red py-16 [--section-heading:var(--section-red-heading)] sm:py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <h1 className="text-(--section-heading)">{m.title}</h1>
        <p className="mt-5 max-w-prose text-lead text-ink-muted">{m.body}</p>
        {digest ? (
          <p className="mt-2 text-sm text-ink-muted">
            {m.reference.replace("{digest}", digest)}
          </p>
        ) : null}
        <div className="mt-8 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => retry()}
            className={buttonStyles()}
          >
            {m.retry}
          </button>
          <SiteLink href="/" className={buttonStyles({ variant: "secondary" })}>
            {m.home}
          </SiteLink>
        </div>
      </div>
    </section>
  );
}
