import { connection } from "next/server";
import { Suspense, type ReactNode } from "react";

/**
 * Content read at request time, such as a published CMS document. The
 * build has no database, so `children(fallback)` (the repo's copy) goes
 * into the static shell, and `children(await load())` streams in for each
 * request: the page keeps its text in the HTML and stays prerendered.
 */
export function Live<T>({
  fallback,
  load,
  children,
}: {
  fallback: T;
  load: () => Promise<T>;
  children: (value: T) => ReactNode;
}) {
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
