import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

// #89: finalising is the only way `school_round.shortlist_finalised` is
// emitted. Outside the event catalogue, its subscribers and the tests, only
// one file in src/server names it: the finalise use case.

const SERVER = join(process.cwd(), "src/server");
const EVENT = '"school_round.shortlist_finalised"';
const CATALOGUE = [
  "outbox/events.ts",
  "modules/notifications/audiences.ts",
  "modules/school-round/rounds-finished-guard.ts",
];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

describe("the shortlist-finalised event", () => {
  it("has one producer: finaliseSchoolRound", () => {
    const naming = sourceFiles(SERVER)
      .filter((path) => readFileSync(path, "utf8").includes(EVENT))
      .map((path) => relative(SERVER, path))
      .filter((path) => !CATALOGUE.includes(path))
      .sort();

    expect(naming).toEqual([
      "modules/school-round/use-cases/finalise-school-round.ts",
    ]);
  });
});
