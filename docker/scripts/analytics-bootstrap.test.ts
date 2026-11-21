import { spawnSync } from "node:child_process";
import {
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
const UMAMI_SQL = readFileSync(
  new URL("../postgres/bootstrap/umami.sql", import.meta.url),
  "utf8"
);

const HEX = /^[0-9a-f]{64}$/;
const PASSWORD = "a".repeat(64);

/**
 * Sources the script (which then only defines its functions) and runs
 * `snippet` in the same shell, with `args` as "$@".
 */
function bootstrap(snippet: string, ...args: string[]) {
  const run = spawnSync(
    "bash",
    ["-c", `source "$1" && shift && ${snippet}`, "bash", SCRIPT, ...args],
    { encoding: "utf8" }
  );
  return { status: run.status, stdout: run.stdout, stderr: run.stderr };
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
