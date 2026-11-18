"use client";

import Link from "next/link";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";

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
    <section className="mx-auto flex max-w-xl flex-col items-center px-4 py-20 text-center sm:px-6">
      <h1 className="text-3xl font-bold tracking-tight">
        Something went wrong
      </h1>
      <p className="mt-4 text-muted-foreground">
        An unexpected error occurred. Please try again.
      </p>
      {digest ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Reference: {digest}
        </p>
      ) : null}
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Button type="button" onClick={() => retry()}>
          Try again
        </Button>
        <Button asChild variant="outline">
          <Link href="/">Go to the home page</Link>
        </Button>
      </div>
    </section>
  );
}
