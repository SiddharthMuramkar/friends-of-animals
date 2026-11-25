/** The directory search is the only page allowed to ask for geolocation. */
export const DIRECTORY_SEARCH_PATH = "/ngos";

/**
 * Response headers, such as Permissions-Policy, apply to the document,
 * not to the route rendered inside it. Crossing this boundary needs a new
 * document so that geolocation is neither blocked on the search page nor
 * left enabled on the pages around it.
 */
export function crossesDirectoryBoundary(from: string, to: string): boolean {
  const directory = (path: string) =>
    path.replace(/\/$/, "") === DIRECTORY_SEARCH_PATH;
  return directory(from) !== directory(to);
}

/**
 * Entering the staff home from outside the staff area can redirect through
 * second-factor verification. Start that navigation with a new document
 * rather than caching a factor refusal in the client route tree; the
 * successful gate then returns directly to the requested home.
 */
/** Galleries carry revocable personal credits: navigate with a fresh
 * document instead of restoring a cached App Router payload. */
export const isGalleryPath = (path: string) =>
  /^\/gallery(?:\/|\?|$)|^\/gallery-report(?:\/|\?|$)/.test(path);
export function requiresDocumentNavigation(from: string, to: string): boolean {
  const inAdmin = from === "/admin" || from.startsWith("/admin/");
  return (
    crossesDirectoryBoundary(from, to) ||
    isGalleryPath(from) ||
    isGalleryPath(to) ||
    (!inAdmin && to.replace(/\/$/, "") === "/admin")
  );
}
