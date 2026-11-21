/**
 * Pages behind sign-in. They are never in navigation for visitors, the
 * sitemap or search results (each sets robots noindex), and they render at
 * request time. Public pages are in ./routes.ts. src/proxy.ts answers any
 * other path under SIGNED_IN_PREFIXES with the 404, so list every page.
 */
export const APP_ROUTES = {
  accountSessions: "/account/sessions",
  accountInbox: "/account/inbox",
  accountNotifications: "/account/notifications",
  accountConsents: "/account/consents",
  adminConsentDocuments: "/admin/consent-documents",
  adminTemplates: "/admin/templates",
  accountSecurity: "/account/security",
  secondFactor: "/auth/second-factor",
  stepUp: "/auth/step-up",
  adminSettings: "/admin/settings",
} as const;

/**
 * Path prefixes that need a signed-in user. src/proxy.ts sends visitors
 * without a session cookie to sign in; #65's CSP gives these a nonce.
 */
export const SIGNED_IN_PREFIXES = ["/account", "/admin", "/auth"] as const;

export function isSignedInPath(pathname: string): boolean {
  return SIGNED_IN_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

/**
 * Pages behind sign-in with a dynamic segment, written as their routes
 * are: `[name]` stands for any one non-empty path segment.
 */
export const DYNAMIC_APP_ROUTES = ["/admin/templates/[key]"] as const;

/** Whether `pathname` fills in `route`, segment by segment. */
function fillsRoute(route: string, pathname: string): boolean {
  const want = route.split("/");
  const got = pathname.split("/");
  return (
    want.length === got.length &&
    want.every((segment, i) =>
      /^\[[^\]/]+\]$/.test(segment) ? got[i] !== "" : segment === got[i]
    )
  );
}

/** Whether `pathname` is one of the pages in APP_ROUTES or DYNAMIC_APP_ROUTES. */
export function isSignedInPage(pathname: string): boolean {
  return (
    (Object.values(APP_ROUTES) as string[]).includes(pathname) ||
    DYNAMIC_APP_ROUTES.some((route) => fillsRoute(route, pathname))
  );
}
