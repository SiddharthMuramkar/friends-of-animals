/**
 * Pages behind sign-in. They are never in navigation for visitors, the
 * sitemap or search results (each sets robots noindex), and they render at
 * request time. Public pages are in ./routes.ts. src/proxy.ts answers any
 * other path under SIGNED_IN_PREFIXES with the 404, so list every page:
 * here, or in APP_ROUTE_TEMPLATES if its path has a dynamic segment.
 */
export const APP_ROUTES = {
  accountSessions: "/account/sessions",
  accountSecurity: "/account/security",
  secondFactor: "/auth/second-factor",
  stepUp: "/auth/step-up",
  /** The file upload demo (#63): every environment but production. */
  accountFiles: "/account/files",
  adminCompetitions: "/admin/competitions",
  adminNewCompetition: "/admin/competitions/new",
} as const;

/**
 * Pages behind sign-in whose path has a dynamic segment, written as in the
 * app directory: each `[name]` stands for one path segment.
 */
export const APP_ROUTE_TEMPLATES = [
  "/admin/competitions/[id]/edit",
  "/admin/competitions/[id]/preview",
] as const;

/**
 * Path prefixes that need a signed-in user. src/proxy.ts sends visitors
 * without a session cookie to sign in; #65's CSP gives these a nonce.
 */
export const SIGNED_IN_PREFIXES = ["/account", "/admin", "/auth"] as const;

export function isSignedInPath(pathname: string): boolean {
  return isUnderPrefix(pathname, SIGNED_IN_PREFIXES);
}

/**
 * True when `pathname` is one of `prefixes` or below one, by whole
 * segments: "/account/x" is under "/account", "/accounts" isn't.
 */
export function isUnderPrefix(
  pathname: string,
  prefixes: readonly string[]
): boolean {
  return prefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

function fitsTemplate(pathname: string, template: string): boolean {
  const segments = pathname.split("/");
  const parts = template.split("/");
  return (
    segments.length === parts.length &&
    parts.every((part, i) =>
      /^\[\w+\]$/.test(part) ? segments[i] !== "" : part === segments[i]
    )
  );
}

/** Whether `pathname` is a page in APP_ROUTES or APP_ROUTE_TEMPLATES. */
export function isSignedInPage(pathname: string): boolean {
  return (
    (Object.values(APP_ROUTES) as string[]).includes(pathname) ||
    APP_ROUTE_TEMPLATES.some((template) => fitsTemplate(pathname, template))
  );
}

/**
 * Pages that exist everywhere but production: src/proxy.ts answers 404
 * for them there, before anything renders.
 */
export const NON_PRODUCTION_PREFIXES = [APP_ROUTES.accountFiles] as const;

export function isNonProductionPath(pathname: string): boolean {
  return NON_PRODUCTION_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}
