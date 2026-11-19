"use client";

import Link from "next/link";
import { type ComponentProps, useSyncExternalStore } from "react";

import { type ConnectionHints, shouldSkipPrefetch } from "@/lib/connection";

type Connection = ConnectionHints & EventTarget;

const connection = () =>
  (navigator as Navigator & { connection?: Connection }).connection;

function subscribe(onChange: () => void) {
  const c = connection();
  c?.addEventListener("change", onChange);
  return () => c?.removeEventListener("change", onChange);
}

const skipPrefetch = () => shouldSkipPrefetch(connection());
// The server can't know the connection: links render as usual and turn
// prefetching off once hydrated.
const skipPrefetchOnServer = () => false;

/**
 * The site's internal link: next/link, except that it never prefetches
 * when the visitor has data saver on or a 2G-slow connection (the App
 * Router doesn't check either). Everyone else keeps instant navigation.
 */
export function SiteLink({ prefetch, ...props }: ComponentProps<typeof Link>) {
  const skip = useSyncExternalStore(
    subscribe,
    skipPrefetch,
    skipPrefetchOnServer
  );
  return <Link prefetch={skip ? false : prefetch} {...props} />;
}
