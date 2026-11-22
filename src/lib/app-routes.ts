import { CMS_DOCUMENT_KEYS } from "../server/modules/cms/domain/documents";

/**
 * Pages behind sign-in. They are never in navigation for visitors, the
 * sitemap or search results (each sets robots noindex), and they render at
 * request time. Public pages are in ./routes.ts. src/proxy.ts answers any
 * other path under SIGNED_IN_PREFIXES with the 404, so list every page:
 * here, or in APP_ROUTE_TEMPLATES if its path has a dynamic segment.
 */
export const APP_ROUTES = {
  accountSessions: "/account/sessions",
  accountInbox: "/account/inbox",
  accountNotifications: "/account/notifications",
  accountSecurity: "/account/security",
  dashboard: "/dashboard",
  adminRoles: "/admin/roles",
  adminAudit: "/admin/audit",
  secondFactor: "/auth/second-factor",
  stepUp: "/auth/step-up",
  /** The file upload demo (#63): every environment but production. */
  accountFiles: "/account/files",
  adminSettings: "/admin/settings",
  accountConsents: "/account/consents",
  adminConsentDocuments: "/admin/consent-documents",
  adminCompetitions: "/admin/competitions",
  adminNewCompetition: "/admin/competitions/new",
  adminCms: "/admin/cms",
  adminTemplates: "/admin/templates",
  institutionRegister: "/institutions/register",
  myInstitution: "/institution",
  adminInstitutions: "/admin/institutions",
  adminInbox: "/admin/inbox",
} as const;

/** One institution's page in the admin area. */
export function adminInstitutionPath(institutionId: string): string {
  return `${APP_ROUTES.adminInstitutions}/${encodeURIComponent(institutionId)}`;
}

/**
 * Pages behind sign-in whose path has a dynamic segment, written as in the
 * app directory: each `[name]` stands for one path segment.
 */
export const APP_ROUTE_TEMPLATES = [
  "/admin/competitions/[id]/edit",
  "/admin/competitions/[id]/preview",
  "/admin/templates/[key]",
  "/admin/institutions/[id]",
  "/admin/inbox/[id]",
] as const;

/**
 * Path prefixes that need a signed-in user. src/proxy.ts sends visitors
 * without a session cookie to sign in; #65's CSP gives these a nonce.
 * Each tree also needs the proxy's matcher to list it, and a layout that
 * waits for the request (src/app/account/layout.tsx), so it has no static
 * shell.
 */
export const SIGNED_IN_PREFIXES = [
  "/account",
  "/admin",
  "/auth",
  "/dashboard",
  "/institution",
  "/institutions/register",
] as const;

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

/** Whether `pathname` is a page in APP_ROUTES, APP_ROUTE_TEMPLATES or one CMS editor. */
export function isSignedInPage(pathname: string): boolean {
  return (
    (Object.values(APP_ROUTES) as string[]).includes(pathname) ||
    APP_ROUTE_TEMPLATES.some((template) => fitsTemplate(pathname, template)) ||
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
