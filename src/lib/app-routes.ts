import { CMS_DOCUMENT_KEYS } from "../server/cms/domain/documents";

/**
 * Pages behind sign-in. They are never in navigation for visitors, the
 * sitemap or search results (each sets robots noindex), and they render at
 * request time. Public pages are in ./routes.ts. src/proxy.ts answers any
 * other path under SIGNED_IN_PREFIXES with the 404, so list every page.
 */
export const APP_ROUTES = {
  accountSessions: "/account/sessions",
  accountConsents: "/account/consents",
  adminConsentDocuments: "/admin/consent-documents",
  adminCms: "/admin/cms",
  accountSecurity: "/account/security",
  secondFactor: "/auth/second-factor",
  stepUp: "/auth/step-up",
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

/** Whether `pathname` is one of the pages in APP_ROUTES. */
export function isSignedInPage(pathname: string): boolean {
  return (
    (Object.values(APP_ROUTES) as string[]).includes(pathname) ||
    CMS_EDITOR_PATHS.has(pathname)
  );
}

/** One editor page per CMS document (#111), and no other path below it. */
const CMS_EDITOR_PATHS: ReadonlySet<string> = new Set(
  CMS_DOCUMENT_KEYS.map((key) => adminCmsDocumentPath(key))
);

/** The editor page of one CMS document (#111). */
export function adminCmsDocumentPath(key: string): `/admin/cms/${string}` {
  return `/admin/cms/${key}`;
}
