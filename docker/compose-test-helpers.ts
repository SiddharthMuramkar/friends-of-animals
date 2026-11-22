// YAML-line helpers for the Compose tests (edge.test.ts, errors.test.ts,
// analytics.test.ts). Docker can't run in the tests, so they read the files
// as lines: these helpers are the one copy of that parsing.

import { readFileSync } from "node:fs";

/** A file next to this module, as text. */
export const readDocker = (path: string) =>
  readFileSync(new URL(path, import.meta.url), "utf8");

/** Lines without comments and blank lines. */
export const lines = (text: string) =>
  text
    .split("\n")
    .map((line) => line.replace(/\s+#.*$/, ""))
    .filter((line) => line.trim() !== "" && !line.trim().startsWith("#"));

export const indent = (line: string) => line.length - line.trimStart().length;

/** The lines nested under the first line matching `key` (by indentation). */
export function block(text: string[], key: RegExp): string[] {
  const start = text.findIndex((line) => key.test(line));
  if (start === -1) return [];
  const depth = indent(text[start] ?? "");
  const end = text.findIndex((line, i) => i > start && indent(line) <= depth);
  return text.slice(start + 1, end === -1 ? undefined : end);
}

/** One service's lines under `services:`, joined. */
export const serviceBlock = (compose: string[], name: string) =>
  block(block(compose, /^services:$/), new RegExp(`^ {2}${name}:$`)).join("\n");

/** The service names under `services:`, in file order. */
export const serviceNames = (compose: string[]) =>
  block(compose, /^services:$/)
    .filter((line) => indent(line) === 2)
    .map((line) => line.trim().replace(/:$/, ""));

/** `text` on one line, with flow sequences as `["a", "b"]` however wrapped. */
export const oneLine = (text: string) =>
  text.replace(/\s+/g, " ").replace(/\[ /g, "[").replace(/,? \]/g, "]");

/**
 * The journald anchor every Compose file here defines, word for word (#66;
 * logging.test.ts checks every file for it).
 */
export const LOGGING_ANCHOR = [
  "x-logging: &logging",
  "  driver: journald",
  "  options:",
  '    tag: "{{.Name}}"',
];
