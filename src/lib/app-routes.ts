/**
 * Pages behind sign-in. They are never in navigation for visitors, the
 * sitemap or search results (each sets robots noindex), and they render at
 * request time. Public pages are in ./routes.ts.
 */
export const APP_ROUTES = {
  accountSessions: "/account/sessions",
  accountConsents: "/account/consents",
  adminConsentDocuments: "/admin/consent-documents",
  institutionRegister: "/institutions/register",
  myInstitution: "/institution",
  adminInstitutions: "/admin/institutions",
} as const;

/** One institution's page in the admin area. */
export function adminInstitutionPath(institutionId: string): string {
  return `${APP_ROUTES.adminInstitutions}/${encodeURIComponent(institutionId)}`;
}

/**
 * Path prefixes that need a signed-in user. src/proxy.ts sends visitors
 * without a session cookie to sign in; #65's CSP gives these a nonce.
 */
export const SIGNED_IN_PREFIXES = [
  "/account",
  "/admin",
  "/institution",
  "/institutions/register",
] as const;

export function isSignedInPath(pathname: string): boolean {
  return SIGNED_IN_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}
