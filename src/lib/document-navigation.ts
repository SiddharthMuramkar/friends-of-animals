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
