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
