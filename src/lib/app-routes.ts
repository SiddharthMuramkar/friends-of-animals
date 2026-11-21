/**
 * Pages behind sign-in. They are never in navigation for visitors, the
 * sitemap or search results (each sets robots noindex), and they render at
 * request time. Public pages are in ./routes.ts. src/proxy.ts answers any
 * other path under SIGNED_IN_PREFIXES with the 404, so list every page.
 */
export const APP_ROUTES = {
  accountSessions: "/account/sessions",
  accountSecurity: "/account/security",
  secondFactor: "/auth/second-factor",
  stepUp: "/auth/step-up",
  accountConsents: "/account/consents",
  adminConsentDocuments: "/admin/consent-documents",
} as const;

/**
 * Path prefixes that need a signed-in user. src/proxy.ts sends visitors
 * without a session cookie to sign in; #65's CSP gives these a nonce.
 * Each tree also needs the proxy's matcher to list it, and a layout that
 * waits for the request (src/app/account/layout.tsx), so it has no static
 * shell.
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

/** Whether `pathname` is one of the pages in APP_ROUTES. */
export function isSignedInPage(pathname: string): boolean {
  return (Object.values(APP_ROUTES) as string[]).includes(pathname);
}
