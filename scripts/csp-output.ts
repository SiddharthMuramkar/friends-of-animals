// Pure checks that `next build` output fits the Content-Security-Policy
// (src/lib/csp.ts), used by scripts/check-build.ts:
//
// - Every public page keeps a static shell. Its policy has no nonce, and a
//   page rendered per request would no longer be "statically rendered".
// - No signed-in page has one. A static shell's scripts were rendered at
//   build time, so they can't carry the request's nonce and are blocked.
// - No prerendered page has an inline event handler or a javascript: URL,
//   which `script-src-attr 'none'` and `script-src` block.

/** The parts of .next/prerender-manifest.json these checks read. */
type ManifestRoute = { response?: string; srcRoute?: string | null };
export type PrerenderManifest = {
  routes: Record<string, ManifestRoute>;
  dynamicRoutes: Record<string, ManifestRoute>;
};

type PublicRoute = { path: `/${string}`; nonProduction?: true };

/** A shell is a prerendered static start of the page: ○ or ◐. */
function hasShell(route: ManifestRoute | undefined): boolean {
  return route !== undefined && route.response !== "empty";
}

/** Every prerendered path of `path`, a route like /blog/[slug]. */
function pathsOf(manifest: PrerenderManifest, path: string): ManifestRoute[] {
  return Object.entries(manifest.routes)
    .filter(([concrete, route]) => (route.srcRoute ?? concrete) === path)
    .map(([, route]) => route);
}

function unprerendered(
  manifest: PrerenderManifest,
  routes: readonly PublicRoute[]
): string[] {
  return routes
    .filter(({ path, nonProduction }) => {
      if (nonProduction) return false;
      if (!path.includes("[")) return !hasShell(manifest.routes[path]);
      const paths = pathsOf(manifest, path);
      return paths.length === 0 || !paths.every(hasShell);
    })
    .map(
      ({ path }) =>
        `${path} is not prerendered, so it can't keep the public CSP without a nonce.`
    );
}

function signedInShells(
  manifest: PrerenderManifest,
  prefixes: readonly string[]
): string[] {
  const inTree = (path: string) =>
    prefixes.some((p) => path === p || path.startsWith(`${p}/`));
  return [
    ...Object.entries(manifest.routes),
    ...Object.entries(manifest.dynamicRoutes),
  ]
    .filter(([path, route]) => inTree(path) && hasShell(route))
    .map(
      ([path]) =>
        `${path} has a static shell, so its scripts can't carry the request's CSP nonce.`
    );
}

/** Attributes whose value is a URL a browser would navigate to or load. */
const URL_ATTRIBUTES = new Set([
  "href",
  "src",
  "action",
  "formaction",
  "xlink:href",
]);

/** A start tag, quotes respected, so `>` inside a value doesn't end it. */
const START_TAG =
  /<([a-z][\w:-]*)((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*\/?>/gi;

const ATTRIBUTE =
  /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

/**
 * `value` without spaces and control characters. Browsers drop leading
 * ones, and tabs and newlines anywhere, before reading a URL's scheme.
 */
function withoutSpaceOrControls(value: string): string {
  return value
    .split("")
    .filter((unit) => unit.charCodeAt(0) > 0x20)
    .join("");
}

/** Script and style bodies hold code, not markup. */
const RAW_TEXT = /<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;

/**
 * The inline event handlers and javascript: URLs in a page's markup, e.g.
 * "an onclick attribute on <button>".
 */
export function inlineHandlers(html: string): string[] {
  const found: string[] = [];
  for (const [, tagName = "", attributes = ""] of html
    .replace(RAW_TEXT, "")
    .matchAll(START_TAG)) {
    const tag = tagName.toLowerCase();
    for (const [, rawName = "", ...values] of attributes.matchAll(ATTRIBUTE)) {
      const name = rawName.toLowerCase();
      const value = values.find((v) => v !== undefined) ?? "";
      if (/^on[a-z]+$/.test(name)) {
        found.push(`an ${name} attribute on <${tag}>`);
      } else if (
        URL_ATTRIBUTES.has(name) &&
        /^javascript:/i.test(withoutSpaceOrControls(value))
      ) {
        found.push(`a javascript: URL in <${tag} ${name}>`);
      }
    }
  }
  return found;
}

/** Everything wrong with a build's output for the CSP, as messages. */
export function cspOutputFailures(build: {
  manifest: PrerenderManifest;
  /** The public routes (src/lib/routes.ts). */
  routes: readonly PublicRoute[];
  /** SIGNED_IN_PREFIXES (src/lib/app-routes.ts). */
  signedInPrefixes: readonly string[];
  /** Every prerendered page and its HTML. */
  pages: readonly { page: string; html: string }[];
}): string[] {
  return [
    ...unprerendered(build.manifest, build.routes),
    ...signedInShells(build.manifest, build.signedInPrefixes),
    ...build.pages.flatMap(({ page, html }) =>
      inlineHandlers(html).map((finding) =>
        finding.startsWith("a javascript:")
          ? `${page} has ${finding}, which the CSP blocks.`
          : `${page} has ${finding}, which script-src-attr 'none' blocks.`
      )
    ),
  ];
}
