// Checks the client output of `next build`. Runs after the build in
// `vercel-build` and the Docker build stage, and by hand with
// `pnpm check:build`. Exits non-zero on a failure, which fails the deploy.
//
// - No client chunk may use syntax newer than the browserslist floor
//   (iOS 16.0): a Next.js or React upgrade could ship it again (#51).
// - Each prerendered page's initial JS, gzipped, stays within the §13.2
//   budget (#45).

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";

import {
  INITIAL_JS_BUDGET,
  initialScripts,
  newerSyntax,
  prerenderedPage,
} from "./client-bundle";

const NEXT_DIR = path.resolve(process.argv[2] ?? ".next");
const CHUNKS_DIR = path.join(NEXT_DIR, "static", "chunks");
const SERVER_DIR = path.join(NEXT_DIR, "server");

/** Every file under `dir` whose name ends with `ext`, recursively. */
function filesUnder(dir: string, ext: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((name) => name.endsWith(ext))
    .map((name) => path.join(dir, name));
}

const kB = (bytes: number) => `${(bytes / 1000).toFixed(1)} kB`;

function checkSyntax(): string[] {
  const failures: string[] = [];
  const chunks = filesUnder(CHUNKS_DIR, ".js");
  if (chunks.length === 0) failures.push(`No client chunks in ${CHUNKS_DIR}.`);
  for (const file of chunks) {
    for (const name of newerSyntax(readFileSync(file, "utf8"))) {
      failures.push(
        `${path.relative(NEXT_DIR, file)} has a ${name}, which iOS 16.0-16.3 ` +
          "cannot parse. Check package.json's browserslist."
      );
    }
  }
  console.log(`Checked ${chunks.length} client chunks for Safari 16.4 syntax.`);
  return failures;
}

function checkInitialJs(): string[] {
  const failures: string[] = [];
  const gzipped = new Map<string, number>();
  const sizeOf = (src: string) => {
    let size = gzipped.get(src);
    if (size === undefined) {
      const file = path.join(NEXT_DIR, src.replace(/^\/_next\//, ""));
      size = gzipSync(readFileSync(file)).length;
      gzipped.set(src, size);
    }
    return size;
  };

  const pages = filesUnder(SERVER_DIR, ".html").flatMap((file) => {
    const page = prerenderedPage(path.relative(SERVER_DIR, file));
    if (page === undefined) return [];
    const html = readFileSync(file, "utf8");
    // A dynamic route's fallback shell (e.g. blog/[slug].html) is empty.
    if (html === "") return [];
    const scripts = initialScripts(html);
    const bytes = scripts.reduce((sum, src) => sum + sizeOf(src), 0);
    return [{ page, bytes }];
  });
  if (!pages.some(({ bytes }) => bytes > 0)) {
    failures.push(`No prerendered page in ${SERVER_DIR} loads a script.`);
  }

  for (const { page, bytes } of pages) {
    if (bytes > INITIAL_JS_BUDGET) {
      failures.push(
        `${page} loads ${kB(bytes)} of JS gzipped, over the ` +
          `${kB(INITIAL_JS_BUDGET)} budget (SPEC §13.2).`
      );
    }
  }
  const largest = pages.toSorted((a, b) => b.bytes - a.bytes).slice(0, 3);
  console.log(
    `Initial JS (gzip) on ${pages.length} pages, budget ` +
      `${kB(INITIAL_JS_BUDGET)}. Largest: ` +
      largest.map(({ page, bytes }) => `${page} ${kB(bytes)}`).join(", ")
  );
  return failures;
}

const failures = [...checkSyntax(), ...checkInitialJs()];
if (failures.length > 0) {
  console.error(`\nBuild check failed:\n- ${failures.join("\n- ")}`);
  process.exitCode = 1;
} else {
  console.log("Build check passed.");
}
