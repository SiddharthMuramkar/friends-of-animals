"use client";

import Link from "next/link";
import { type ComponentProps, useSyncExternalStore } from "react";

import { type ConnectionHints, shouldSkipPrefetch } from "@/lib/connection";
import {
  isGalleryPath,
  requiresDocumentNavigation,
} from "@/lib/document-navigation";
import { isModifiedClick } from "@/lib/in-page";
import { PAGE_NAVIGATION } from "@/lib/page-transition";

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
 * Its navigation carries PAGE_NAVIGATION, the only transition the page
 * cross-fades for (page-transition.ts).
 */
export function SiteLink({
  prefetch,
  transitionTypes,
  onClick,
  ...props
}: ComponentProps<typeof Link>) {
  const skip = useSyncExternalStore(
    subscribe,
    skipPrefetch,
    skipPrefetchOnServer
  );
  return (
    <Link
      prefetch={
        skip || (typeof props.href === "string" && isGalleryPath(props.href))
          ? false
          : prefetch
      }
      transitionTypes={[PAGE_NAVIGATION, ...(transitionTypes ?? [])]}
      {...props}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented || isModifiedClick(event)) return;
        const link = event.currentTarget;
        if (
          (link.target && link.target !== "_self") ||
          link.hasAttribute("download") ||
          link.origin !== window.location.origin ||
          !requiresDocumentNavigation(window.location.pathname, link.pathname)
        )
          return;
        // Keep the link's ordinary browser navigation semantics, replacing
        // Next's client transition only across the document boundary.
        event.preventDefault();
        window.location.assign(link.href);
      }}
    />
  );
}
