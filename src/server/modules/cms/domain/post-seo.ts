import type { Metadata } from "next";

import type { PostView } from "./post-view";

export function blogPostingJsonLd(
  _post: PostView,
  _base: URL,
  _options: { siteImageSrc?: string } = {}
): Record<string, unknown> {
  return {};
}

export function postBreadcrumbJsonLd(
  _post: PostView,
  _base: URL,
  _names: { home: string; index: string }
): Record<string, unknown> {
  return {};
}

export function postMetadata(_post: PostView): Metadata {
  return {};
}
