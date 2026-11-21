// docker/workers.yml can't be started here (no docker), so these tests read
// its text: the services, their limits, health checks, connections and
// secrets. The health check's command itself is run against real files.

import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const TEXT = readFileSync(new URL("./workers.yml", import.meta.url), "utf8");
const SERVICES = ["worker-prod", "worker-staging", "worker-preview"];

/** The lines indented under a top-level `key:`, or under `services:`. */
function block(name: string, parent?: string): string {
  const lines = TEXT.split("\n");
  const indent = parent === undefined ? "" : "  ";
  let start = 0;
  if (parent !== undefined) {
    start = lines.indexOf(`${parent}:`);
    expect(start, `${parent}: not found`).toBeGreaterThanOrEqual(0);
  }
  const head = lines.findIndex(
    (line, i) =>
      i >= start &&
      (line === `${indent}${name}:` || line.startsWith(`${indent}${name}: &`))
  );
  expect(head, `${name} not found`).toBeGreaterThanOrEqual(0);
  const body: string[] = [];
  for (const line of lines.slice(head + 1)) {
    if (line.trim() !== "" && !line.startsWith(`${indent}  `)) break;
    body.push(line);
  }
  return body.join("\n");
}

/** The settings every worker merges in (`<<: *worker`). */
const shared = () => block("x-worker");
const service = (name: string) => block(name, "services");

/** The health check's shell command, as Compose passes it to sh -c. */
function healthCommand(): string {
  const match = /test:\n\s+- CMD-SHELL\n\s+- (.+)\n/.exec(shared());
  expect(match, "a CMD-SHELL health check").not.toBeNull();
  return match![1]!;
}

describe("docker/workers.yml", () => {
  it("defines the production, staging and shared preview workers", () => {
    const names = [...block("services").matchAll(/^ {2}([a-z-]+):$/gm)].map(
      (m) => m[1]
    );
    expect(names).toEqual(SERVICES);
  });

  it.each(SERVICES)(
    "gives %s the shared worker settings and its own limits",
    (name) => {
      const own = service(name);
      expect(own).toMatch(/^ {4}<<: \*worker$/m);
      expect(own).toMatch(/^ {4}cpus: [0-9.]+$/m);
      expect(own).toMatch(/^ {4}mem_limit: [0-9]+m$/m);
    }
  );

  it("restarts the workers, keeps bounded json-file logs and publishes no port", () => {
    expect(shared()).toMatch(/^ {2}restart: unless-stopped$/m);
    expect(shared()).toMatch(/driver: json-file/);
    expect(shared()).toMatch(/max-size: "\d+m"/);
    expect(shared()).toMatch(/max-file: "\d+"/);
    expect(TEXT).not.toMatch(/^\s+ports:/m);
    expect(TEXT).not.toMatch(/^\s+expose:/m);
  });

  it("runs the worker image target read-only on the db network", () => {
    expect(shared()).toMatch(/target: worker/);
    expect(shared()).toMatch(/^ {2}read_only: true$/m);
    expect(shared()).toMatch(/^ {4}- db$/m);
    expect(block("networks")).toMatch(/external: true/);
    expect(block("networks")).toMatch(/name: foa-vps_db/);
  });

  it("builds one image per worker, so redeploying one never swaps another's", () => {
    const images = SERVICES.map(
      (name) => /image: (\S+)/.exec(service(name))?.[1]
    );
    expect(new Set(images).size).toBe(3);
  });

  it.each([
    [
      "worker-prod",
      "single",
      "production",
      "WORKER_DATABASE_URL",
      "foa_worker@10.112.12.10:5432/foa",
    ],
    [
      "worker-staging",
      "single",
      "staging",
      "WORKER_DATABASE_URL",
      "staging_worker@10.112.12.11:5432/foa_staging",
    ],
    [
      "worker-preview",
      "preview",
      "preview",
      "WORKER_ADMIN_URL",
      "nonprod_worker@10.112.12.11:5432/postgres",
    ],
  ])(
    "connects %s to Postgres directly, not through PgBouncer",
    (name, mode, appEnv, variable, target) => {
      const own = service(name);
      expect(own).toContain(`WORKER_MODE: ${mode}`);
      expect(own).toContain(`APP_ENV: ${appEnv}`);
      expect(own).toContain(`${variable}: postgres://${target}`);
      expect(own).not.toMatch(/6432|pgbouncer/i);
    }
  );

  it("keeps passwords out of the file: each worker reads its own secret", () => {
    expect(TEXT).not.toMatch(/postgres:\/\/[^@\s]+:[^@\s]+@/);
    const files = SERVICES.map((name) => {
      const own = service(name);
      expect(own).toContain("WORKER_PASSWORD_FILE: /run/secrets/db_password");
      const source = /source: (\S+)\n\s+target: db_password/.exec(own)?.[1];
      expect(source, `${name}'s secret`).toBeDefined();
      return source;
    });
    expect(new Set(files).size).toBe(3);
    for (const source of files) {
      expect(block("secrets")).toContain(
        `${source}:\n    file: /etc/foa/secrets/${source}`
      );
    }
  });

  it("caps the shared preview worker at one connection per preview database", () => {
    expect(service("worker-preview")).toContain(
      "WORKER_CONNECTIONS_PER_DATABASE: 1"
    );
  });

  describe("its health check", () => {
    const dir = mkdtempSync(join(tmpdir(), "foa-worker-health-"));
    afterAll(() => rmSync(dir, { recursive: true, force: true }));

    function healthy(ageSeconds: number | undefined): boolean {
      const file = join(dir, `heartbeat-${ageSeconds ?? "missing"}`);
      if (ageSeconds !== undefined) {
        writeFileSync(file, "2027-01-15T04:30:00.000Z\n");
        const at = new Date(Date.now() - ageSeconds * 1000);
        utimesSync(file, at, at);
      }
      const command = healthCommand().replaceAll(
        "/tmp/foa-worker-heartbeat",
        file
      );
      return spawnSync("sh", ["-c", command]).status === 0;
    }

    it("passes while the heartbeat file is under 120 seconds old", () => {
      expect(healthy(1)).toBe(true);
      expect(healthy(110)).toBe(true);
    });

    it("fails once it is older, or missing", () => {
      expect(healthy(130)).toBe(false);
      expect(healthy(3600)).toBe(false);
      expect(healthy(undefined)).toBe(false);
    });

    it("reads the file the worker writes", () => {
      for (const name of SERVICES) {
        expect(service(name)).not.toContain("WORKER_HEARTBEAT_FILE");
      }
      expect(healthCommand()).toContain("/tmp/foa-worker-heartbeat");
    });
  });
});
