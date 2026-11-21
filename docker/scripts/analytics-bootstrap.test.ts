import { spawnSync, type SpawnSyncOptions } from "node:child_process";
import {
  chmodSync,
  chownSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const SCRIPT = fileURLToPath(
  new URL("./analytics-bootstrap.sh", import.meta.url)
);
const ADMIN_SCRIPT = readFileSync(
  new URL("./umami-admin-password.mjs", import.meta.url),
  "utf8"
);
const UMAMI_SQL = readFileSync(
  new URL("../postgres/bootstrap/umami.sql", import.meta.url),
  "utf8"
);

const HEX = /^[0-9a-f]{64}$/;
const PASSWORD = "a".repeat(64);

/**
 * When the tests run as root, main() runs as nobody (R-26), so even a path
 * the test forgot to point at the temporary directory can't reach the
 * host's /etc/foa or docker. Group 0 lets it read this checkout.
 */
const AS_ROOT = process.getuid?.() === 0;
const UNPRIVILEGED: SpawnSyncOptions = AS_ROOT ? { uid: 65534, gid: 0 } : {};

/**
 * Sources the script (which then only defines its functions) and runs
 * `snippet` in the same shell, with `args` as "$@".
 */
function bootstrap(snippet: string, ...args: string[]) {
  return bootstrapWith({}, snippet, ...args);
}

function bootstrapWith(
  options: SpawnSyncOptions,
  snippet: string,
  ...args: string[]
) {
  const run = spawnSync(
    "bash",
    ["-c", `source "$1" && shift && ${snippet}`, "bash", SCRIPT, ...args],
    { ...options, encoding: "utf8" }
  );
  return {
    status: run.status,
    stdout: String(run.stdout),
    stderr: String(run.stderr),
  };
}

/** KEY=value lines of an env file, without comments. */
function envOf(path: string): Record<string, string> {
  return Object.fromEntries(
    readFileSync(path, "utf8")
      .split("\n")
      .filter((line) => /^[A-Z_]+=/.test(line))
      .map((line) => [
        line.slice(0, line.indexOf("=")),
        line.slice(line.indexOf("=") + 1),
      ])
  );
}

let dir: string;
let envFile: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "analytics-bootstrap-"));
  envFile = join(dir, "analytics.env");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("analytics-bootstrap.sh env file", () => {
  const write = () => bootstrap('write_env "$1"', envFile);

  it("creates Umami's env file, readable by its owner only", () => {
    expect(write()).toMatchObject({ status: 0, stdout: `wrote ${envFile}\n` });

    const env = envOf(envFile);
    expect(Object.keys(env).sort()).toEqual([
      "APP_SECRET",
      "DATABASE_URL",
      "DISABLE_TELEMETRY",
      "TWO_FACTOR_ENCRYPTION_KEY",
    ]);
    const url = new URL(env.DATABASE_URL ?? "");
    expect(url.protocol).toBe("postgresql:");
    expect(url.username).toBe("umami");
    expect(url.password).toMatch(HEX);
    expect(url.host).toBe("10.112.12.10:5432");
    expect(url.pathname).toBe("/umami");
    expect(env.APP_SECRET).toMatch(HEX);
    expect(env.TWO_FACTOR_ENCRYPTION_KEY).toMatch(HEX);
    expect(
      new Set([url.password, env.APP_SECRET, env.TWO_FACTOR_ENCRYPTION_KEY])
        .size
    ).toBe(3);
    expect(env.DISABLE_TELEMETRY).toBe("1");
    expect(statSync(envFile).mode & 0o777).toBe(0o600);
  });

  it("keeps every value on a second run", () => {
    write();
    const first = readFileSync(envFile, "utf8");

    expect(write()).toMatchObject({ status: 0, stdout: `kept ${envFile}\n` });
    expect(readFileSync(envFile, "utf8")).toBe(first);
  });

  it("fills in a missing value and keeps the rest", () => {
    writeFileSync(
      envFile,
      `DATABASE_URL=postgresql://umami:${PASSWORD}@10.112.12.10:5432/umami\n`,
      { mode: 0o600 }
    );

    expect(write().status).toBe(0);
    const env = envOf(envFile);
    expect(env.DATABASE_URL).toContain(`:${PASSWORD}@`);
    expect(env.APP_SECRET).toMatch(HEX);
  });

  it("refuses a database password that isn't 64 hex characters", () => {
    const before =
      "DATABASE_URL=postgresql://umami:pa'ss@10.112.12.10:5432/umami\n";
    writeFileSync(envFile, before, { mode: 0o600 });

    const run = write();
    expect(run.status).toBe(1);
    expect(run.stderr).toMatch(/64 hex/);
    expect(run.stderr).not.toContain("pa'ss");
    expect(readFileSync(envFile, "utf8")).toBe(before);
  });

  it("never prints a secret", () => {
    const run = write();
    const env = envOf(envFile);
    for (const value of [env.APP_SECRET, env.TWO_FACTOR_ENCRYPTION_KEY]) {
      expect(run.stdout + run.stderr).not.toContain(value);
    }
  });
});

describe("analytics-bootstrap.sh database role", () => {
  /** apply_sql with `docker` replaced by a stub that records its input. */
  const apply = (password: string) =>
    bootstrap(
      'out="$2"; docker() { printf "%s\\n" "$@" >"$out/argv"; cat >"$out/stdin"; }; apply_sql "$1"',
      password,
      dir
    );
  const argv = () => readFileSync(join(dir, "argv"), "utf8");
  const stdin = () => readFileSync(join(dir, "stdin"), "utf8");

  it("runs umami.sql in pg-prod as postgres", () => {
    expect(apply(PASSWORD).status).toBe(0);
    expect(argv().split("\n").slice(0, 5)).toEqual([
      "exec",
      "-i",
      "-u",
      "postgres",
      "foa-pg-prod",
    ]);
    expect(stdin()).toContain("\\i /opt/foa/bootstrap/umami.sql\n");
  });

  it("passes the password over stdin, never as an argument", () => {
    apply(PASSWORD);
    expect(argv()).not.toContain(PASSWORD);
    expect(stdin()).toContain(`\\set pw '${PASSWORD}'\n`);
  });

  it("reloads pg_hba.conf so the umami rule applies", () => {
    apply(PASSWORD);
    expect(stdin()).toMatch(/SELECT pg_reload_conf\(\)/);
  });

  it.each(["", "abc", `${"a".repeat(63)}'`, "A".repeat(64)])(
    "refuses the password %j without running anything",
    (password) => {
      const run = apply(password);
      expect(run.status).toBe(1);
      expect(() => argv()).toThrow();
    }
  );
});

describe("analytics-bootstrap.sh directories", () => {
  /** private_dir with `install` replaced by a stub that records its call. */
  const privateDir = (path: string) =>
    bootstrap(
      'out="$2"; install() { echo "$*" >>"$out/install"; }; private_dir "$1"',
      path,
      dir
    );

  it("creates a missing directory for root only", () => {
    expect(privateDir(join(dir, "foa")).status).toBe(0);
    expect(readFileSync(join(dir, "install"), "utf8")).toBe(
      `-d -m 0700 -o root -g root ${join(dir, "foa")}\n`
    );
  });

  it("leaves an existing directory's mode and owner alone", () => {
    const existing = join(dir, "foa");
    mkdirSync(existing, { mode: 0o755 });
    chmodSync(existing, 0o755);

    expect(privateDir(existing).status).toBe(0);
    expect(statSync(existing).mode & 0o777).toBe(0o755);
    expect(() => readFileSync(join(dir, "install"))).toThrow();
  });
});

describe("analytics-bootstrap.sh admin password", () => {
  const adminFile = () => join(dir, "umami_admin_password");

  it("creates the admin password file, readable by its owner only", () => {
    const run = bootstrap('write_admin_password "$1"', adminFile());

    expect(run).toMatchObject({ status: 0, stdout: `wrote ${adminFile()}\n` });
    const password = readFileSync(adminFile(), "utf8").trim();
    expect(password).toMatch(HEX);
    expect(statSync(adminFile()).mode & 0o777).toBe(0o400);
    expect(run.stdout + run.stderr).not.toContain(password);
  });

  it("keeps an existing admin password", () => {
    writeFileSync(adminFile(), `${PASSWORD}\n`, { mode: 0o400 });

    expect(bootstrap('write_admin_password "$1"', adminFile())).toMatchObject({
      status: 0,
      stdout: `kept ${adminFile()}\n`,
    });
    expect(readFileSync(adminFile(), "utf8")).toBe(`${PASSWORD}\n`);
  });

  it("refuses an admin password that isn't 64 hex characters", () => {
    writeFileSync(adminFile(), "umami\n", { mode: 0o600 });

    const run = bootstrap('write_admin_password "$1"', adminFile());
    expect(run.status).toBe(1);
    expect(run.stderr).toMatch(/64 hex/);
    expect(run.stderr).not.toContain("umami\n");
  });

  /** replace_seeded_login with `docker` stubbed to record its input. */
  const replace = () =>
    bootstrap(
      [
        'out="$2"',
        'docker() { printf "%s\\n" "${@:1:6}" >"$out/argv"; printf "%s" "$7" >"$out/script"; cat >"$out/stdin"; }',
        'replace_seeded_login "$1"',
      ].join("; "),
      adminFile(),
      dir
    );

  it("runs umami-admin-password.mjs inside foa-umami", () => {
    writeFileSync(adminFile(), `${PASSWORD}\n`, { mode: 0o400 });

    expect(replace().status).toBe(0);
    expect(readFileSync(join(dir, "argv"), "utf8").split("\n")).toEqual([
      "exec",
      "-i",
      "foa-umami",
      "node",
      "--input-type=module",
      "-e",
      "",
    ]);
    expect(readFileSync(join(dir, "script"), "utf8")).toBe(
      ADMIN_SCRIPT.trimEnd()
    );
  });

  it("passes the new password over stdin, never as an argument", () => {
    writeFileSync(adminFile(), `${PASSWORD}\n`, { mode: 0o400 });

    replace();
    expect(readFileSync(join(dir, "stdin"), "utf8")).toBe(`${PASSWORD}\n`);
    expect(readFileSync(join(dir, "argv"), "utf8")).not.toContain(PASSWORD);
  });

  it("refuses a password file that isn't 64 hex characters", () => {
    writeFileSync(adminFile(), "umami\n", { mode: 0o600 });

    expect(replace().status).toBe(1);
    expect(() => readFileSync(join(dir, "argv"))).toThrow();
  });
});

describe("analytics-bootstrap.sh bring-up", () => {
  let root: string;

  beforeEach(() => {
    // Everything main() may write lives here, owned by whoever runs it.
    root = join(dir, "etc-foa");
    mkdirSync(join(root, "secrets"), { recursive: true });
    mkdirSync(join(root, "gates"));
    if (AS_ROOT) {
      for (const path of [
        dir,
        root,
        join(root, "secrets"),
        join(root, "gates"),
      ]) {
        chownSync(path, 65534, 0);
      }
    }
  });

  /**
   * main() with every file it writes in `root`, and `id`, `install` and
   * `docker` stubbed. The stubs record each call, shell-quoted, one per
   * line; docker also records whether Caddy's gate for the stats site was
   * open at that moment, and keeps what foa-umami's exec read from stdin.
   * With `swapFails`, foa-umami's exec (the login swap) exits 1.
   */
  const bringUp = ({ swapFails = false } = {}) =>
    bootstrapWith(
      UNPRIVILEGED,
      [
        'root="$1"',
        `swap_status=${swapFails ? 1 : 0}`,
        'ENV_FILE="$root/analytics.env"',
        'ADMIN_FILE="$root/secrets/umami_admin_password"',
        'GATE_FILE="$root/gates/stats"',
        "id() { echo 0; }",
        'install() { echo "install $*" >>"$root/calls"; }',
        'docker() { printf "%q " "$@" >>"$root/calls"; echo >>"$root/calls"; if [ -e "$GATE_FILE" ]; then echo open; else echo closed; fi >>"$root/gate"; if [ "$1 $3" = "exec foa-umami" ]; then cat >"$root/umami-stdin"; return "$swap_status"; else cat >/dev/null; fi; }',
        "main",
      ].join("; "),
      root
    );
  const calls = () =>
    readFileSync(join(root, "calls"), "utf8")
      .trimEnd()
      .split("\n")
      .map((line) => line.trimEnd());
  /** "open" or "closed": Caddy's gate for the stats site at each docker call. */
  const gateAtCalls = () =>
    readFileSync(join(root, "gate"), "utf8").trimEnd().split("\n");
  const gateFile = () => join(root, "gates", "stats");

  it("writes the env file and the role, starts Umami, then replaces its seeded login", () => {
    const run = bringUp();

    expect(run).toMatchObject({ status: 0, stderr: "" });
    expect(run.stdout.split("\n").slice(0, 3)).toEqual([
      `closed ${gateFile()}: Caddy answers stats.friendsofanimals.dev with 503`,
      `wrote ${join(root, "analytics.env")}`,
      "applied umami.sql on foa-pg-prod and reloaded its configuration",
    ]);
    const [sql, start, admin, ...rest] = calls();
    expect(sql).toMatch(/^exec -i -u postgres foa-pg-prod psql /);
    expect(start).toMatch(
      /^compose -f \S+\/docker\/analytics\.yml up -d --wait umami$/
    );
    expect(admin).toMatch(/^exec -i foa-umami node --input-type=module -e /);
    expect(rest).toEqual([]);
  });

  it("opens Caddy's stats site only after Umami's seeded login is replaced", () => {
    const run = bringUp();

    expect(run.status).toBe(0);
    // Umami starts, and its admin/umami login is swapped, while Caddy still
    // answers stats.friendsofanimals.dev with 503 (caddy/Caddyfile).
    const [, start, admin] = calls();
    expect(start).toMatch(/ up -d --wait umami$/);
    expect(admin).toMatch(/^exec -i foa-umami /);
    expect(gateAtCalls().slice(1, 3)).toEqual(["closed", "closed"]);
    expect(existsSync(gateFile())).toBe(true);
  });

  it("closes the stats site before changing the database, on a rerun too", () => {
    writeFileSync(gateFile(), ""); // opened by an earlier run

    const run = bringUp();

    expect(run.status).toBe(0);
    // Umami may already be running and see the newly provisioned database.
    expect(gateAtCalls()).toEqual(["closed", "closed", "closed"]);
    expect(existsSync(gateFile())).toBe(true);
  });

  it("leaves the stats site closed when replacing the seeded login fails", () => {
    writeFileSync(gateFile(), ""); // opened by an earlier run

    const run = bringUp({ swapFails: true });

    expect(run.status).not.toBe(0);
    expect(existsSync(gateFile())).toBe(false);
  });

  it("asks for no tunnel token: Caddy (edge.yml) is Umami's ingress", () => {
    const run = bringUp();

    expect(run.status).toBe(0);
    expect(run.stdout + run.stderr).not.toMatch(/tunnel|cloudflare/i);
  });

  it("hands Umami the new admin password from a 0400 file, never printing it", () => {
    const run = bringUp();

    const file = join(root, "secrets", "umami_admin_password");
    const password = readFileSync(file, "utf8").trim();
    expect(password).toMatch(HEX);
    expect(statSync(file).mode & 0o777).toBe(0o400);
    expect(readFileSync(join(root, "umami-stdin"), "utf8").trim()).toBe(
      password
    );
    expect(run.stdout + run.stderr).not.toContain(password);
  });

  it("keeps the admin password on a rerun", () => {
    bringUp();
    const file = join(root, "secrets", "umami_admin_password");
    const first = readFileSync(file, "utf8");

    expect(bringUp().status).toBe(0);
    expect(readFileSync(file, "utf8")).toBe(first);
  });
});

describe("analytics-bootstrap.sh usage", () => {
  it("prints its usage with --help", () => {
    const run = spawnSync("bash", [SCRIPT, "--help"], { encoding: "utf8" });
    expect(run.status).toBe(0);
    expect(run.stdout).toMatch(/Usage: .*analytics-bootstrap\.sh/);
  });

  it("refuses an unknown argument", () => {
    const run = spawnSync("bash", [SCRIPT, "--force"], { encoding: "utf8" });
    expect(run.status).toBe(2);
    expect(run.stderr).toMatch(/unknown argument: --force/);
  });

  it("says nothing about a tunnel in its usage", () => {
    const run = spawnSync("bash", [SCRIPT, "--help"], { encoding: "utf8" });
    expect(run.stdout).not.toMatch(/tunnel|cloudflare/i);
  });
});

describe("umami.sql", () => {
  const sql = UMAMI_SQL.replace(/--.*$/gm, "");

  it("creates the login role umami with a connection limit", () => {
    expect(sql).toMatch(/CREATE ROLE umami;/);
    expect(sql).toMatch(
      /ALTER ROLE umami WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT\s+NOREPLICATION NOBYPASSRLS CONNECTION LIMIT \d+;/
    );
  });

  it("sets the password from the psql variable and refuses to run without it", () => {
    expect(sql).toMatch(/ALTER ROLE umami WITH PASSWORD :'pw';/);
    expect(sql).toMatch(/\\if :\{\?pw\}/);
    expect(sql).not.toMatch(/\\set pw/);
  });

  it("keeps the password out of pg_stat_statements and the log", () => {
    for (const setting of [
      "SET pg_stat_statements.track_utility = off;",
      "SET pg_stat_statements.track = none;",
      "SET log_statement = 'none';",
      "SET log_min_error_statement = 'panic';",
    ]) {
      expect(sql).toContain(setting);
    }
  });

  it("gives umami its own database and nothing else", () => {
    expect(sql).toMatch(/CREATE DATABASE umami OWNER umami;/);
    expect(sql).toMatch(/REVOKE ALL ON DATABASE umami FROM PUBLIC;/);
    expect(sql).not.toMatch(/\bfoa\b/);
    expect(sql).not.toMatch(/GRANT .* TO umami/);
  });

  it("is idempotent: it creates the role and the database only when missing", () => {
    expect(sql).toMatch(
      /SELECT NOT EXISTS \(SELECT 1 FROM pg_roles WHERE rolname = 'umami'\) AS missing \\gset\n\\if :missing\n\s+CREATE ROLE umami;/
    );
    expect(sql).toMatch(
      /SELECT NOT EXISTS \(SELECT 1 FROM pg_database WHERE datname = 'umami'\) AS missing \\gset\n\\if :missing\n\s+CREATE DATABASE umami OWNER umami;/
    );
  });
});
