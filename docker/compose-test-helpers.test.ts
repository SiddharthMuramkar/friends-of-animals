// The YAML-line helpers the Compose tests share (edge, errors, analytics).
// One copy, so the journald anchor and the parsing can't drift between them.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  LOGGING_ANCHOR,
  block,
  lines,
  oneLine,
  serviceBlock,
} from "./compose-test-helpers";

const SAMPLE = [
  "# a comment",
  "name: demo",
  "",
  "services:",
  "  web:",
  "    image: nginx:1.29.0 # pinned",
  "    cap_drop:",
  "      - ALL",
  "  db:",
  "    image: postgres:18.7-alpine",
  "networks:",
  "  default: {}",
].join("\n");

describe("compose-test-helpers", () => {
  it("drops comments and blank lines", () => {
    expect(lines(SAMPLE)).toEqual([
      "name: demo",
      "services:",
      "  web:",
      "    image: nginx:1.29.0",
      "    cap_drop:",
      "      - ALL",
      "  db:",
      "    image: postgres:18.7-alpine",
      "networks:",
      "  default: {}",
    ]);
  });

  it("finds the lines nested under a key by indentation", () => {
    expect(block(lines(SAMPLE), /^ {2}web:$/)).toEqual([
      "    image: nginx:1.29.0",
      "    cap_drop:",
      "      - ALL",
    ]);
    expect(block(lines(SAMPLE), /^missing:$/)).toEqual([]);
  });

  it("returns one service's configuration as text", () => {
    expect(serviceBlock(lines(SAMPLE), "db")).toBe(
      "    image: postgres:18.7-alpine"
    );
  });

  it("writes a flow sequence on one line however it is wrapped", () => {
    expect(oneLine('test:\n  [\n    "CMD",\n    "true",\n  ]')).toBe(
      'test: ["CMD", "true"]'
    );
  });

  it("holds the journald anchor every Compose file defines (#66)", () => {
    expect(LOGGING_ANCHOR).toEqual([
      "x-logging: &logging",
      "  driver: journald",
      "  options:",
      '    tag: "{{.Name}}"',
    ]);
  });

  it.each(["edge.test.ts", "errors.test.ts", "analytics.test.ts"])(
    "%s uses these helpers instead of its own copies",
    (file) => {
      const text = readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
      expect(text).toMatch(/from "\.\/compose-test-helpers";$/m);
      expect(text).not.toMatch(
        /^(?:const|function) (?:lines|indent|block|oneLine|LOGGING_ANCHOR)\b/m
      );
    }
  );
});
