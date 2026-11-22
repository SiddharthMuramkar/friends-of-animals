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
 * static shell renders whenever it can, on a build with a database or
 * when the server regenerates the page. It gives null when it can't read,
 * and Draft Mode skips it, so both keep the fallback and `load`.
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
