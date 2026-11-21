/**
 * The Content-Security-Policy, built in one place for both kinds of page:
 *
 * - Public pages are prerendered, so they can't carry a per-request nonce.
 *   Their policy allows self-hosted scripts plus inline <script> elements
 *   (Next's App Router streams its flight data as inline scripts), and
 *   blocks inline event handlers with `script-src-attr 'none'`.
 *   next.config.ts sends it through the one `headers()`.
 * - Signed-in pages render per request. The proxy sends them a strict
 *   nonce policy with 'strict-dynamic'; Next reads the nonce from the
 *   request's policy header and puts it on its own scripts.
 *
 * Keep this file free of Next.js, `@/` and server-only imports:
 * next.config.ts loads it under plain Node.
 */

import { createHash } from "node:crypto";

import type { SecurityHeader } from "./security-headers";
import { themeScript } from "./theme";

/** The report endpoint (src/app/api/csp-report/route.ts). */
export const CSP_REPORT_PATH = "/api/csp-report";

/** The Reporting API group name that `report-to` points at. */
export const CSP_REPORT_GROUP = "csp";

type Directive =
  | "default-src"
  | "script-src"
  | "script-src-attr"
  | "style-src"
  | "img-src"
  | "font-src"
  | "connect-src"
  | "frame-src"
  | "object-src"
  | "base-uri"
  | "form-action"
  | "frame-ancestors"
  | "upgrade-insecure-requests"
  | "report-uri"
  | "report-to";

type Policy = Partial<Record<Directive, readonly string[]>>;

/** Which kind of page a policy is for. */
export type CspArea = "public" | "signedIn";

/** Directives a feature may add origins to. */
type FeatureDirective = Extract<
  Directive,
  | "script-src"
  | "style-src"
  | "img-src"
  | "font-src"
  | "connect-src"
  | "frame-src"
  | "form-action"
>;

/**
 * Origins one feature needs (error tracking, file storage, checkout,
 * analytics), so it extends the policy without editing the rules above.
 * Only https/wss origins: keywords, wildcards and bare schemes would
 * weaken the policy and are refused. On signed-in pages 'strict-dynamic'
 * ignores script origins, so a third-party script there needs the nonce.
 */
export type CspSources = {
  feature: string;
  /** Deployments (APP_ENV values) that get them; every one if omitted. */
  appEnvs?: readonly string[];
  /** Kinds of page that get them; both if omitted. */
  areas?: readonly CspArea[];
  directives: Partial<Record<FeatureDirective, readonly string[]>>;
};

/** What a policy depends on: the deployment, the Node mode, the features. */
export type CspContext = {
  appEnv: string | undefined;
  nodeEnv: string | undefined;
  sources?: readonly CspSources[];
};

const ORIGIN_SOURCE =
  /^(?:https|wss):\/\/[a-z0-9.-]+(?::\d+)?(?:\/[\w./-]*)?$/i;

/** `policy` plus the sources of every feature that applies here. */
function withFeatures(
  policy: Policy,
  area: CspArea,
  context: CspContext
): Policy {
  const result: Policy = { ...policy };
  for (const feature of context.sources ?? []) {
    if (feature.appEnvs && !feature.appEnvs.includes(context.appEnv ?? "")) {
      continue;
    }
    if (feature.areas && !feature.areas.includes(area)) continue;
    for (const [name, added] of Object.entries(feature.directives) as [
      FeatureDirective,
      readonly string[],
    ][]) {
      for (const source of added) {
        if (!ORIGIN_SOURCE.test(source)) {
          throw new RangeError(
            `CSP sources for "${feature.feature}" must be https or wss ` +
              `origins, not ${JSON.stringify(source)}`
          );
        }
      }
      const current = (result[name] ?? []).filter((s) => s !== "'none'");
      result[name] = [...new Set([...current, ...added])];
    }
  }
  return result;
}

/**
 * Enforce, or only report. Staging and production report first, so problems
 * show up before anything is blocked; the owner picks when to enforce
 * (HR-19). Local runs and previews enforce, so Seam 2 catches breakage.
 */
export type CspMode = "enforce" | "report-only";

export function cspMode(appEnv: string | undefined): CspMode {
  return appEnv === "staging" || appEnv === "production"
    ? "report-only"
    : "enforce";
}

function headerName(mode: CspMode): string {
  return mode === "enforce"
    ? "Content-Security-Policy"
    : "Content-Security-Policy-Report-Only";
}

/** `local` (or unset) is plain http on 127.0.0.1; everything else is https. */
function isLocal(appEnv: string | undefined): boolean {
  return appEnv === undefined || appEnv === "local";
}

/**
 * The whole policy around `scripts` (the area's script-src). Browsers
 * ignore `frame-ancestors` and `upgrade-insecure-requests` in a report-only
 * policy and warn in the console, so those two go only into an enforced one.
 */
function policyWith(scripts: readonly string[], context: CspContext): Policy {
  const mode = cspMode(context.appEnv);
  const enforced = mode === "enforce";
  // React rebuilds server error stacks with eval under next dev only.
  const devEval = context.nodeEnv === "development" ? ["'unsafe-eval'"] : [];
  return {
    "default-src": ["'self'"],
    "script-src": [...scripts, ...devEval],
    "script-src-attr": ["'none'"],
    // React renders `style` attributes, which a nonce can't cover.
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "data:", "blob:"],
    "font-src": ["'self'"],
    "connect-src": ["'self'"],
    "frame-src": ["'none'"],
    "object-src": ["'none'"],
    "base-uri": ["'none'"],
    "form-action": ["'self'"],
    ...(enforced && { "frame-ancestors": ["'none'"] }),
    ...(enforced &&
      !isLocal(context.appEnv) && { "upgrade-insecure-requests": [] }),
    "report-uri": [CSP_REPORT_PATH],
    "report-to": [CSP_REPORT_GROUP],
  };
}

function serialize(policy: Policy): string {
  return Object.entries(policy)
    .map(([name, sources]) => [name, ...sources].join(" "))
    .join("; ");
}

function header(
  area: CspArea,
  scripts: readonly string[],
  context: CspContext
): SecurityHeader {
  return {
    key: headerName(cspMode(context.appEnv)),
    value: serialize(withFeatures(policyWith(scripts, context), area, context)),
  };
}

/** Names the endpoint that a policy's `report-to` sends reports to. */
export function reportingEndpoints(): SecurityHeader {
  return {
    key: "Reporting-Endpoints",
    value: `${CSP_REPORT_GROUP}="${CSP_REPORT_PATH}"`,
  };
}

/** One next.config.ts `headers()` rule. */
export type HeaderRule = { source: string; headers: SecurityHeader[] };

/** A path prefix of plain lower-case segments, safe inside a pattern. */
const PREFIX_PATTERN = /^\/[a-z0-9-]+(?:\/[a-z0-9-]+)*$/;

/**
 * The CSP's next.config.ts `headers()` rules. Every path names the report
 * endpoint. Every path outside `signedInPrefixes` gets the public policy;
 * those trees get the nonce policy from src/proxy.ts instead, so no
 * response carries two policies.
 *
 * Next matches these sources case-insensitively and the proxy's matcher
 * case-sensitively, so a wrong-case path such as /Account gets neither
 * policy. No page lives there: it is the static 404.
 */
export function cspHeaderRules(
  context: CspContext,
  signedInPrefixes: readonly `/${string}`[]
): HeaderRule[] {
  const trees = signedInPrefixes.map((prefix) => {
    if (!PREFIX_PATTERN.test(prefix)) {
      throw new RangeError(
        `A signed-in prefix must be lower-case path segments, not ${JSON.stringify(prefix)}`
      );
    }
    return prefix.slice(1);
  });
  const outside =
    trees.length === 0
      ? "/:path*"
      : `/:path((?!(?:${trees.join("|")})(?:/|$)).*)`;
  return [
    { source: "/:path*", headers: [reportingEndpoints()] },
    { source: outside, headers: [publicCsp(context)] },
  ];
}

/** The policy for prerendered public pages: no nonce. */
export function publicCsp(context: CspContext): SecurityHeader {
  return header("public", ["'self'", "'unsafe-inline'"], context);
}

/**
 * The root layout's inline theme script, allowed on signed-in pages by its
 * hash. Public pages allow it with the rest of the inline scripts; a hash
 * there would switch 'unsafe-inline' off and block Next's flight data.
 */
const THEME_SCRIPT_HASH = `'sha256-${createHash("sha256")
  .update(themeScript)
  .digest("base64")}'`;

/** Base64 only, so a nonce can't end the source list or the header. */
const NONCE_PATTERN = /^[A-Za-z0-9+/_-]+={0,2}$/;

/**
 * The policy for signed-in pages, which render per request: scripts need
 * this request's nonce, and 'strict-dynamic' trusts what they load.
 * ('self' is only a fallback for browsers without 'strict-dynamic'.)
 */
export function signedInCsp(
  context: CspContext,
  nonce: string
): SecurityHeader {
  if (!NONCE_PATTERN.test(nonce)) {
    throw new RangeError("A CSP nonce must be non-empty base64");
  }
  return header(
    "signedIn",
    ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", THEME_SCRIPT_HASH],
    context
  );
}

/** A fresh nonce for one request: 128 random bits, base64. */
export function createNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}
