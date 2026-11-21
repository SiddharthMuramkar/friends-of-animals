// VPS logs are kept for a year (#66). Docker can't run here, so these
// tests read the files: every service of every Compose file logs to
// journald through one shared anchor, journald keeps a year, and the
// runbook lists the uptime checks. A driver `docker logs` can't read
// would silently blind CrowdSec (crowdsec/acquis-foa-pgbouncer.yaml reads
// foa-pgbouncer with `source: docker`), so the driver is pinned.

import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (name: string) =>
  readFileSync(new URL(`./${name}`, import.meta.url), "utf8");

/** Every Compose file here: compose.yml, and workers.yml (#61). */
const COMPOSE_FILES = readdirSync(new URL(".", import.meta.url))
  .filter((name) => name.endsWith(".yml"))
  .filter((name) => /^services:$/m.test(read(name)));

/** The anchor every file defines, word for word. */
const LOGGING_ANCHOR = [
  "x-logging: &logging",
  "  driver: journald",
  "  options:",
  '    tag: "{{.Name}}"',
].join("\n");

/** The lines indented under top-level `key:` (`key: &anchor` too). */
function topLevelBlock(text: string, key: string): string | undefined {
  const lines = text.split("\n");
  const head = lines.findIndex(
    (line) => line === `${key}:` || line.startsWith(`${key}: &`)
  );
  if (head < 0) return undefined;
  const body: string[] = [];
  for (const line of lines.slice(head + 1)) {
    if (line.trim() !== "" && !line.startsWith("  ")) break;
    body.push(line);
  }
  return body.join("\n");
}

/** Each service under `services:`, with the lines that configure it. */
function services(text: string): Map<string, string> {
  const result = new Map<string, string>();
  let current: string | undefined;
  for (const line of (topLevelBlock(text, "services") ?? "").split("\n")) {
    const name = /^ {2}([a-z0-9-]+):$/.exec(line)?.[1];
    if (name !== undefined) {
      current = name;
      result.set(name, "");
    } else if (current !== undefined) {
      result.set(current, `${result.get(current)}${line}\n`);
    }
  }
  return result;
}

/** A service's own lines plus those of the `x-` blocks it merges. */
function effectiveConfig(text: string, service: string): string {
  const merged = [...service.matchAll(/^ {4}<<: \*([a-z0-9-]+)$/gm)].map(
    ([, anchor]) => {
      const key = text
        .split("\n")
        .find((line) => line.endsWith(`: &${anchor}`))
        ?.split(":")[0];
      return key === undefined ? "" : (topLevelBlock(text, key) ?? "");
    }
  );
  return [service, ...merged].join("\n");
}

describe("container logs", () => {
  it("cover the database stack, and the workers once #61 adds them", () => {
    expect(COMPOSE_FILES).toContain("compose.yml");
  });

  it.each(COMPOSE_FILES)("%s defines the shared journald anchor", (file) => {
    const text = read(file);
    expect(
      `x-logging: &logging\n${topLevelBlock(text, "x-logging")}`.trimEnd()
    ).toBe(LOGGING_ANCHOR);
  });

  it.each(COMPOSE_FILES)("%s logs every service through it", (file) => {
    const text = read(file);
    const all = services(text);
    expect(all.size).toBeGreaterThan(0);
    for (const [name, lines] of all) {
      expect(effectiveConfig(text, lines), name).toMatch(
        /^ +logging: \*logging$/m
      );
    }
  });

  it.each(COMPOSE_FILES)(
    "%s has no other logging settings and no json-file rotation",
    (file) => {
      const text = read(file);
      const logging = text
        .split("\n")
        .filter((line) => /^\s*logging:/.test(line))
        .map((line) => line.trim());
      expect(new Set(logging)).toEqual(new Set(["logging: *logging"]));
      expect(text).not.toMatch(/json-file|max-size|max-file/);
    }
  );
});

describe("systemd/journald-foa.conf", () => {
  const settings = () =>
    new Map(
      read("systemd/journald-foa.conf")
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line !== "" && !line.startsWith("#"))
        .map((line) => {
          const [key, ...value] = line.split("=");
          return [key, value.join("=")] as const;
        })
    );

  it("keeps journal files on disk, and entries for a year", () => {
    const journal = settings();
    expect(journal.get("[Journal]")).toBe("");
    expect(journal.get("Storage")).toBe("persistent");
    expect(journal.get("MaxRetentionSec")).toBe("1year");
  });

  it("caps the journal's disk use explicitly", () => {
    // journald's default cap is 10 % of the disk, at most 4 GiB: far less
    // than a year of container logs.
    const cap = settings().get("SystemMaxUse") ?? "";
    expect(cap).toMatch(/^\d+G$/);
    expect(Number.parseInt(cap)).toBeGreaterThan(4);
  });
});

describe("README.md", () => {
  const readme = read("README.md");

  /** A `## heading` section's text, up to the next `## `. */
  const section = (heading: string) => {
    const start = readme.indexOf(`\n## ${heading}\n`);
    expect(start, `## ${heading}`).toBeGreaterThanOrEqual(0);
    const end = readme.indexOf("\n## ", start + 1);
    return readme.slice(start, end < 0 ? undefined : end);
  };

  /** What the uptime checks call: the app, the pooler and the worker. */
  const CHECK_TARGETS = [
    "`/api/health`",
    "`db.shipped-it.dev:6432`",
    "`/api/health/worker`",
  ];

  /** The lines of the "Monitoring and alerts" table, its header first. */
  const checkTable = () =>
    section("Monitoring and alerts")
      .split("\n")
      .filter((line) => line.startsWith("|"));

  /** A table line's cells, trimmed. */
  const cells = (line: string) =>
    line
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim());

  it("lists one row per uptime check", () => {
    const rows = checkTable();
    for (const target of CHECK_TARGETS) {
      expect(
        rows.filter((row) => row.includes(target)),
        target
      ).toHaveLength(1);
    }
  });

  it("says where each check alerts and how to silence it", () => {
    const [header = "", ...rows] = checkTable();
    const columns = cells(header);
    const alertTo = columns.findIndex((column) =>
      /alert goes to/i.test(column)
    );
    const silence = columns.findIndex((column) => /silence/i.test(column));
    expect(alertTo, "an 'Alert goes to' column").toBeGreaterThanOrEqual(0);
    expect(silence, "a column on silencing").toBeGreaterThanOrEqual(0);

    for (const target of CHECK_TARGETS) {
      const row = cells(rows.find((line) => line.includes(target)) ?? "");
      expect(row[alertTo] ?? "", `${target}: alert goes to`).toMatch(/\w/);
      expect(row[silence] ?? "", `${target}: how to silence`).toMatch(/\w/);
    }
  });

  it("says where logs go and for how long", () => {
    const logs = section("Logs");
    expect(logs).toMatch(/journald/);
    expect(logs).toMatch(/365 days/);
    expect(logs).toMatch(/log drain/i);
  });
});
