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

/** Whether IPv4 `address` lies inside `cidr` (e.g. 10.112.14.0/28). */
function inCidr(address: string, cidr: string): boolean {
  const toInt = (ip: string) =>
    ip.split(".").reduce((n, octet) => n * 256 + Number(octet), 0);
  const [base, bits] = cidr.split("/");
  const size = 2 ** (32 - Number(bits));
  const start = Math.floor(toInt(base!) / size) * size;
  const at = toInt(address);
  return at >= start && at < start + size;
}

const SENTRY_FILE = "/etc/foa/secrets/worker_sentry.env";

/** A service's `env_file:` entries, in order. */
function envFiles(own: string): { path: string; required: boolean }[] {
  const list = /^ {4}env_file:\n((?: {6}.*\n?)+)/m.exec(own)?.[1] ?? "";
  return [
    ...list.matchAll(/^ {6}- path: (\S+)\n {8}required: (true|false)$/gm),
  ].map((m) => ({ path: m[1]!, required: m[2] === "true" }));
}

/** The health check's shell command, as Compose passes it to sh -c. */
function healthCommand(): string {
  const match = /test:\n\s+- CMD-SHELL\n\s+- (.+)\n/.exec(shared());
  expect(match, "a CMD-SHELL health check").not.toBeNull();
  return match![1]!;
}

describe("docker/workers.yml", () => {
  it("defines the production, staging and shared preview workers and their sidecars", () => {
    const names = [...block("services").matchAll(/^ {2}([a-z-]+):$/gm)].map(
      (m) => m[1]
    );
    expect(names).toEqual([
      ...SERVICES,
      "foa-clamav",
      "foa-gotenberg",
      "worker-media",
    ]);
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

  it("restarts the workers, logs through the shared anchor and publishes no port", () => {
    expect(shared()).toMatch(/^ {2}restart: unless-stopped$/m);
    // #66: journald, kept a year (docker/logging.test.ts), not json-file.
    expect(shared()).toMatch(/^ {2}logging: \*logging$/m);
    expect(block("x-logging")).toMatch(/^ {2}driver: journald$/m);
    expect(TEXT).not.toMatch(/json-file|max-size|max-file/);
    expect(TEXT).not.toMatch(/^\s+ports:/m);
    expect(TEXT).not.toMatch(/^\s+expose:/m);
  });

  it("reads every worker's Sentry DSN from /etc/foa/secrets, if there is one", () => {
    for (const name of [...SERVICES, "worker-media"]) {
      expect(envFiles(service(name)), name).toContainEqual({
        path: SENTRY_FILE,
        required: false,
      });
    }
    // The DSN itself never sits in git.
    expect(TEXT).not.toMatch(/SENTRY_DSN:/);
  });

  it.each([
    ["worker-prod", "/etc/foa/secrets/worker_prod_r2.env"],
    ["worker-staging", "/etc/foa/preview-files.env"],
    ["worker-preview", "/etc/foa/preview-files.env"],
  ])(
    "gives %s its own environment's R2 credentials for the upload scan",
    (name, file) => {
      // Without all four R2_ variables the worker's scan fails every file
      // (src/worker/main.ts), so each database worker needs its bucket's.
      expect(envFiles(service(name))).toEqual([
        { path: SENTRY_FILE, required: false },
        { path: file, required: false },
      ]);
    }
  );

  it("shares no env file through the worker anchor, so production's R2 key stays with worker-prod", () => {
    // Every worker merges x-worker, preview and staging included: a file
    // listed there would hand production's bucket to all of them.
    expect(shared()).not.toMatch(/env_file:/);
    const prodR2 = "/etc/foa/secrets/worker_prod_r2.env";
    for (const name of ["worker-staging", "worker-preview", "worker-media"]) {
      expect(service(name), name).not.toContain(prodR2);
    }
    expect(TEXT.split(prodR2)).toHaveLength(2);
    // The keys themselves never sit in git.
    expect(TEXT).not.toMatch(/R2_[A-Z_]+:/);
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

  it("keeps ClamAV scanning on the private bridge while FreshClam updates", () => {
    const clamav = service("foa-clamav");
    expect(clamav).toMatch(/^ {4}image: clamav\/clamav:\d+\.\d+\.\d+$/m);
    expect(clamav).toContain("entrypoint: /init-unprivileged");
    expect(clamav).toContain("user: clamav");
    expect(clamav).toContain('CLAMAV_NO_FRESHCLAMD: "false"');
    expect(clamav).toContain("foa-clamav-db:/var/lib/clamav");
    expect(block("volumes")).toContain("foa-clamav-db:");
    expect(clamav).toContain("clamdcheck.sh");
    expect(clamav).toContain("start_period: 6m");
    expect(block("networks")).toContain("scan:\n    internal: true");
    expect(clamav).toMatch(/^ {6}scan:$/m);
    expect(clamav).toMatch(/^ {8}ipv4_address: 10\.112\.14\.2$/m);
    expect(clamav).toMatch(/^ {6}clamav-updates: \{\}$/m);
    expect(clamav).toContain("./clamav/clamd.conf:/etc/clamav/clamd.conf:ro");
    const clamd = readFileSync(
      new URL("./clamav/clamd.conf", import.meta.url),
      "utf8"
    );
    expect(clamd.match(/^TCPAddr .+$/gm)).toEqual([
      "TCPAddr 127.0.0.1",
      "TCPAddr 10.112.14.2",
    ]);
    expect(clamd).toContain("TCPSocket 3310");
    // /init-unprivileged waits for this socket before it counts clamd as up.
    expect(clamd).toMatch(/^LocalSocket \/tmp\/clamd\.sock$/m);
    expect(clamd).toContain("ConcurrentDatabaseReload no");
    // A file over clamd's scan limits is only partly scanned; without this
    // it would still come back `stream: OK` and count as clean.
    expect(clamd).toMatch(/^AlertExceedsMax yes$/m);
    expect(clamav).toContain(
      "./clamav/freshclam.conf:/etc/clamav/freshclam.conf:ro"
    );
    const freshclam = readFileSync(
      new URL("./clamav/freshclam.conf", import.meta.url),
      "utf8"
    );
    expect(freshclam).toContain("NotifyClamd /etc/clamav/clamd.conf");
    expect(freshclam).toContain("TestDatabases no");
  });

  it("keeps clamd's fixed scan address out of the range Docker hands out", () => {
    // The workers join `scan` with dynamic addresses and start alongside
    // foa-clamav. If Docker could hand out clamd's address, a worker that
    // attaches first takes it and foa-clamav fails with "Address already in
    // use". So dynamic addresses come from an ip_range that excludes it.
    const scan = /^ {2}scan:\n((?: {4}.*\n)+)/m.exec(`${block("networks")}\n`);
    expect(scan, "networks.scan").not.toBeNull();
    const subnet = /^ {8}- subnet: (\S+)$/m.exec(scan![1]!)?.[1];
    const range = /^ {10}ip_range: (\S+)$/m.exec(scan![1]!)?.[1];
    expect(subnet, "scan subnet").toBeDefined();
    expect(range, "scan ip_range").toBeDefined();
    const fixed = /^ {8}ipv4_address: (\S+)$/m.exec(service("foa-clamav"))?.[1];
    expect(fixed, "foa-clamav's scan address").toBeDefined();
    expect(inCidr(fixed!, subnet!), `${fixed} in ${subnet}`).toBe(true);
    expect(
      inCidr(range!.split("/")[0]!, subnet!),
      `${range} in ${subnet}`
    ).toBe(true);
    expect(inCidr(fixed!, range!), `${fixed} outside ${range}`).toBe(false);
  });

  it("configures every database worker to scan through foa-clamav:3310", () => {
    expect(shared()).toMatch(/^ {4}- scan$/m);
    for (const name of SERVICES) {
      expect(service(name)).toContain("<<: *clamd");
    }
    const scanner = block("x-clamd");
    expect(scanner).toContain("CLAMD_HOST: foa-clamav");
    expect(scanner).toContain('CLAMD_PORT: "3310"');
  });

  it("renders PDFs from local files through a private Gotenberg 9 API", () => {
    const gotenberg = service("foa-gotenberg");
    const image = /^ {4}image: gotenberg\/gotenberg:9\.(\d+)\.\d+$/m.exec(
      gotenberg
    );
    expect(image).not.toBeNull();
    expect(Number(image?.[1])).toBeGreaterThanOrEqual(8);
    expect(gotenberg).toContain("http://127.0.0.1:3000/health");
    expect(gotenberg).toMatch(/^ {4}networks:\n {6}- pdf$/m);
    expect(block("networks")).toContain("pdf:\n    internal: true");
    expect(gotenberg).toContain("--api-timeout=30s");
    expect(gotenberg).toContain("--chromium-allow-list=^file:///tmp/");
    expect(gotenberg).toContain("--libreoffice-allow-list=^file:///tmp/");
    expect(gotenberg).toContain("--libreoffice-enable-macros=false");
    expect(gotenberg).toContain("--api-disable-download-from=true");
    expect(gotenberg).toContain("--webhook-disable=true");
    expect(gotenberg).toContain("--pdf-deny-list=.");
  });

  it("keeps the media worker opt-in on the PDF bridge and uses the media entry point", () => {
    const media = service("worker-media");
    expect(media).toMatch(/^ {4}profiles:\n {6}- media$/m);
    expect(media).toContain("<<: *worker");
    expect(media).toContain("image: foa-workers/worker-media\n");
    expect(media).toContain(
      'command: ["node", "--import", "tsx", "src/worker-media/main.ts"]'
    );
    expect(media).toContain("GOTENBERG_URL: http://foa-gotenberg:3000");
    expect(media).toMatch(/^ {4}networks:\n {6}- pdf$/m);
    expect(media).toContain("cpus: 1");
    expect(media).toContain("pids_limit: 128");
    expect(media).not.toMatch(/^ {4}secrets:|WORKER_DATABASE_URL/m);
    expect(shared()).toContain("read_only: true");
    expect(shared()).toMatch(/^ {4}- \/tmp$/m);
    expect(healthCommand()).toContain("/tmp/foa-worker-heartbeat");
  });

  it.each([
    ["foa-clamav", "2g"],
    ["foa-gotenberg", "1g"],
    ["worker-media", "2g"],
  ])("limits %s to %s and drops container privileges", (name, memory) => {
    const own = service(name);
    expect(own).toMatch(new RegExp(`^ {4}mem_limit: ${memory}$`, "m"));
    expect(own).toMatch(/^ {4}oom_score_adj: 500$/m);
    expect(own).not.toMatch(/^ {4}network_mode:|^ {6}(?:- db$|db:)/m);
    const settings = name === "worker-media" ? shared() : own;
    expect(settings).toMatch(/^ +healthcheck:$/m);
    expect(settings).toMatch(/^ +restart: unless-stopped$/m);
    expect(settings).toMatch(/^ +logging: \*logging$/m);
    expect(settings).toMatch(/cap_drop:\n +- ALL\n/);
    expect(settings).toMatch(/security_opt:\n +- no-new-privileges:true\n/);
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
