// Checks the client output of `next build`. Runs after the build in
// `vercel-build` and the Docker build stage, and by hand with
// `pnpm check:build`. Exits non-zero on a failure, which fails the deploy.
//
// No client chunk may use syntax newer than the browserslist floor
// (iOS 16.0): a Next.js or React upgrade could ship it again (#51).

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { newerSyntax } from "./client-bundle";

const NEXT_DIR = path.resolve(process.argv[2] ?? ".next");
const CHUNKS_DIR = path.join(NEXT_DIR, "static", "chunks");

/** Every file under `dir` whose name ends with `ext`, recursively. */
function filesUnder(dir: string, ext: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((name) => name.endsWith(ext))
    .map((name) => path.join(dir, name));
}

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

const failures = checkSyntax();
if (failures.length > 0) {
  console.error(`\nBuild check failed:\n- ${failures.join("\n- ")}`);
  process.exitCode = 1;
} else {
  console.log("Build check passed.");
}
