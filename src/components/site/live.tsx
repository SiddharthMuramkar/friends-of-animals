import { draftMode } from "next/headers";
import { connection } from "next/server";
import { Suspense, type ReactNode } from "react";

/**
 * Content read at request time, such as a published CMS document. The
 * build has no database, so `children(fallback)` (the repo's copy) goes
 * into the static shell, and `children(await load())` streams in for each
 * request: the page keeps its text in the HTML and stays prerendered.
 *
 * Streaming in replaces the fallback's elements with new ones after the
 * first paint, which a page's main content can't afford (a tap on its
 * first button would miss). `published` avoids that: a cached read the
 * static shell renders when the server regenerates the page, which it
 * does on its first request after the build. It gives null when it can't
 * read (always while `next build` prerenders), and Draft Mode skips it, so
 * both keep the fallback and `load`. It must be a `"use cache"` read: a
 * request resuming the shell re-runs Live, and only a cached answer is
 * sure to match the one the shell was rendered with.
 */
export async function Live<T>({
  fallback,
  load,
  published,
  children,
}: {
  fallback: T;
  load: () => Promise<T>;
  published?: () => Promise<T | null>;
  children: (value: T) => ReactNode;
}) {
  if (published && !(await draftMode()).isEnabled) {
    const value = await published();
    if (value !== null) return children(value);
  }
  return (
    <Suspense fallback={children(fallback)}>
      <Loaded load={load}>{children}</Loaded>
    </Suspense>
  );
}

async function Loaded<T>({
  load,
  children,
}: {
  load: () => Promise<T>;
  children: (value: T) => ReactNode;
}) {
  await connection();
  return children(await load());
}
