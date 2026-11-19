// Pure checks on the client output of `next build`, used by
// scripts/check-build.ts. Kept apart from that script so they can be tested
// without a build.

/**
 * Syntax that Safari and iOS Safari only parse from 16.4. package.json's
 * browserslist reaches iOS 16.0 (SPEC §13.7), so SWC rewrites these when it
 * can. A chunk that still has one fails to parse on iOS 16.0-16.3, and if
 * it is a root chunk React never hydrates there (#51).
 */
const SAFARI_16_4_SYNTAX = [
  // `class A { static { ... } }`; not `x.static{`, `"static"` or `static(){`.
  { name: "class static block", pattern: /(?<![\w$.])static\s*\{/ },
  // `(?<=a)` and `(?<!a)`, in a RegExp literal or a `new RegExp` string.
  { name: "RegExp lookbehind", pattern: /\(\?<[=!]/ },
] as const;

export type SyntaxName = (typeof SAFARI_16_4_SYNTAX)[number]["name"];

/** The Safari 16.4 syntax a chunk's source contains, if any. */
export function newerSyntax(source: string): SyntaxName[] {
  return SAFARI_16_4_SYNTAX.filter(({ pattern }) => pattern.test(source)).map(
    ({ name }) => name
  );
}

/**
 * The App Router page a prerendered `.html` file renders, from its path
 * under `.next/server`, or undefined for any other file. A plain
 * `next build` writes pages to `app/<page>.html`. With a deployment adapter,
 * which Vercel always sets, Next writes them to the route cache instead,
 * `route-cache/APP_PAGE/<sha256 of the route>/$/<page>.html`.
 */
export function prerenderedPage(serverPath: string): string | undefined {
  const page =
    /^app(\/.+)\.html$/.exec(serverPath)?.[1] ??
    /^route-cache\/APP_PAGE\/[0-9a-f]+\/\$(\/.+)\.html$/.exec(serverPath)?.[1];
  if (page === undefined) return undefined;
  return page === "/index" ? "/" : page;
}

/** SPEC §13.2: "Initial JS ≤ 170 KB gzipped on public pages" (in bytes). */
export const INITIAL_JS_BUDGET = 170_000;

/**
 * The scripts a prerendered page loads up front: the paths of its
 * `<script src>` tags under /_next/static/, without the `noModule`
 * polyfills, which current browsers never fetch. This is how #45 measured
 * initial JS.
 */
export function initialScripts(html: string): string[] {
  const scripts = new Set<string>();
  for (const [, attrs = ""] of html.matchAll(/<script\b([^>]*)>/gi)) {
    if (/\bnomodule\b/i.test(attrs)) continue;
    const src = /\bsrc="(\/_next\/static\/[^"?#]+\.js)/.exec(attrs)?.[1];
    if (src) scripts.add(src);
  }
  return [...scripts];
}
