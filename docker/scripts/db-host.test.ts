import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

// The VPS database scripts take PgBouncer's public host name from
// FOA_DB_DOMAIN. `--print-config` resolves and checks a script's settings,
// prints them as name=value lines and exits before it touches /etc, docker
// or the network, so these tests run anywhere, as any user.

const PRODUCTION_HOST = "db.friendsofanimals.dev";
const SCRIPTS = [
  "bootstrap-secrets.sh",
  "cert-renew.sh",
  "install-cert.sh",
  "smoke-test.sh",
];

// On the VPS the tests run as root, beside the live database stack. There
// the scripts run as nobody (uid 65534, no groups, no new privileges), so
// one that ever ignored --print-config fails on /etc/foa and the docker
// socket instead of changing them. nobody can't read the checkout under
// /root, so they run from a world-readable copy.
const tmp = mkdtempSync(join(tmpdir(), "db-host-test-"));
chmodSync(tmp, 0o755);
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
for (const script of SCRIPTS) {
  copyFileSync(
    fileURLToPath(new URL(`./${script}`, import.meta.url)),
    join(tmp, script)
  );
}
const BASH: [string, ...string[]] =
  process.getuid?.() === 0
    ? [
        "setpriv",
        "--no-new-privs",
        "--reuid=65534",
        "--regid=65534",
        "--clear-groups",
        "--",
        "bash",
      ]
    : ["bash"];

// A stand-in for `ss` on PATH, so a test decides what listens on port 80.
const bin = join(tmp, "bin");
mkdirSync(bin, { mode: 0o755 });
writeFileSync(join(bin, "ss"), '#!/bin/sh\nprintf %s "$FAKE_SS_LISTENERS"\n', {
  mode: 0o755,
});

type Env = Record<string, string>;

/** Runs `script ...args --print-config` with only `env` (and PATH) set. */
function printConfig(script: string, env: Env = {}, ...args: string[]) {
  const [command, ...prefix] = BASH;
  const run = spawnSync(
    command,
    [...prefix, join(tmp, script), ...args, "--print-config"],
    {
      cwd: tmp,
      encoding: "utf8",
      // Nothing else from this process: a FOA_* variable set where the
      // tests run must not leak in. (The scripts ignore NODE_ENV; Next.js
      // types it as required.)
      env: {
        FAKE_SS_LISTENERS: "",
        ...env,
        NODE_ENV: "test",
        PATH: `${bin}:${process.env.PATH}`,
      },
    }
  );
  if (run.error) throw run.error;
  return {
    status: run.status,
    stdout: run.stdout,
    stderr: run.stderr,
    config: settings(run.stdout),
  };
}

/** `name=value` lines as an object, skipping `#` comments. */
function settings(stdout: string): Record<string, string> {
  return Object.fromEntries(
    stdout
      .split("\n")
      .filter((line) => line !== "" && !line.startsWith("#"))
      .map((line) => {
        const at = line.indexOf("=");
        return [line.slice(0, at), line.slice(at + 1)];
      })
  );
}

describe("install-cert.sh", () => {
  const dir = mkdtempSync(join(tmp, "issued-"));
  chmodSync(dir, 0o755);
  const crt = join(dir, "fullchain.pem");
  const key = join(dir, "privkey.pem");
  const empty = join(dir, "empty.pem");
  writeFileSync(crt, "certificate\n");
  writeFileSync(key, "key\n");
  writeFileSync(empty, "");

  it("installs lego's certificate for db.friendsofanimals.dev by default", () => {
    expect(printConfig("install-cert.sh")).toMatchObject({
      status: 0,
      config: {
        domain: PRODUCTION_HOST,
        source: "lego",
        crt: "/etc/foa/lego/certificates/db.friendsofanimals.dev.crt",
        key: "/etc/foa/lego/certificates/db.friendsofanimals.dev.key",
      },
    });
  });

  it("takes the host from FOA_DB_DOMAIN", () => {
    expect(
      printConfig("install-cert.sh", { FOA_DB_DOMAIN: "db.example.test" })
    ).toMatchObject({
      status: 0,
      config: {
        domain: "db.example.test",
        source: "lego",
        crt: "/etc/foa/lego/certificates/db.example.test.crt",
        key: "/etc/foa/lego/certificates/db.example.test.key",
      },
    });
  });

  it("installs an issued pair from FOA_CERT_CRT and FOA_CERT_KEY instead of lego's", () => {
    expect(
      printConfig("install-cert.sh", { FOA_CERT_CRT: crt, FOA_CERT_KEY: key })
    ).toMatchObject({
      status: 0,
      config: { domain: PRODUCTION_HOST, source: "override", crt, key },
    });
  });

  it.each([
    ["FOA_CERT_CRT without FOA_CERT_KEY", { FOA_CERT_CRT: crt }],
    ["FOA_CERT_KEY without FOA_CERT_CRT", { FOA_CERT_KEY: key }],
  ])("refuses %s", (_, env) => {
    const run = printConfig("install-cert.sh", env);
    expect(run.status).toBe(2);
    expect(run.stdout).toBe("");
    expect(run.stderr).toMatch(
      /set both FOA_CERT_CRT and FOA_CERT_KEY, or neither/
    );
  });

  it.each([
    ["a missing", join(dir, "missing.pem"), key, join(dir, "missing.pem")],
    ["an empty", crt, empty, empty],
  ])("refuses %s override file", (_, certificate, privateKey, named) => {
    const run = printConfig("install-cert.sh", {
      FOA_CERT_CRT: certificate,
      FOA_CERT_KEY: privateKey,
    });
    expect(run.status).toBe(1);
    expect(run.stdout).toBe("");
    expect(run.stderr).toContain(`${named} is missing or empty`);
  });
});

describe("cert-renew.sh", () => {
  it("asks Let's Encrypt for a certificate for db.friendsofanimals.dev by default", () => {
    expect(printConfig("cert-renew.sh")).toMatchObject({
      status: 0,
      config: {
        domain: PRODUCTION_HOST,
        domains: PRODUCTION_HOST,
        server: "letsencrypt",
        lego_dir: "/etc/foa/lego",
      },
    });
  });

  it("takes the host from FOA_DB_DOMAIN and adds FOA_DB_DOMAIN_ALIASES after it", () => {
    // lego names the files after the first name, which install-cert.sh
    // looks up.
    expect(
      printConfig("cert-renew.sh", {
        FOA_DB_DOMAIN: "db.example.test",
        FOA_DB_DOMAIN_ALIASES: " db-old.example.test  db-older.example.test ",
      })
    ).toMatchObject({
      status: 0,
      config: {
        domain: "db.example.test",
        domains: "db.example.test db-old.example.test db-older.example.test",
      },
    });
  });

  it("uses the staging CA and its own directory with --staging", () => {
    expect(printConfig("cert-renew.sh", {}, "--staging")).toMatchObject({
      status: 0,
      config: {
        server: "letsencrypt-staging",
        lego_dir: "/etc/foa/lego-staging",
      },
    });
  });

  // `ss -Htln 'sport = :80'` lines: state, queues, local and peer address.
  it.each([
    ["nothing listens", ""],
    [
      "only a local service listens",
      "LISTEN 0      4096   127.0.0.1:80       0.0.0.0:*\n",
    ],
  ])(
    "answers the challenge itself on the public address when %s on port 80",
    (_, listeners) => {
      expect(
        printConfig("cert-renew.sh", { FAKE_SS_LISTENERS: listeners })
      ).toMatchObject({
        status: 0,
        config: { challenge: "standalone", listen: "189.72.156.29:80" },
      });
    }
  );

  it.each([
    ["every address (Caddy)", "LISTEN 0      4096   *:80      *:*\n"],
    ["every IPv4 address", "LISTEN 0      4096   0.0.0.0:80      0.0.0.0:*\n"],
    ["every IPv6 address", "LISTEN 0      4096   [::]:80      [::]:*\n"],
    [
      "the public address",
      "LISTEN 0      511    189.72.156.29:80      0.0.0.0:*\n",
    ],
  ])(
    "leaves the challenge in the webroot for the server listening on %s",
    (_, listeners) => {
      expect(
        printConfig("cert-renew.sh", { FAKE_SS_LISTENERS: listeners })
      ).toMatchObject({
        status: 0,
        config: { challenge: "webroot", webroot: "/var/lib/foa/acme-webroot" },
      });
    }
  );

  it("takes the webroot from FOA_ACME_WEBROOT", () => {
    expect(
      printConfig("cert-renew.sh", {
        FAKE_SS_LISTENERS: "LISTEN 0      4096   *:80      *:*\n",
        FOA_ACME_WEBROOT: "/srv/acme",
      })
    ).toMatchObject({
      status: 0,
      config: { challenge: "webroot", webroot: "/srv/acme" },
    });
  });

  it("refuses an unknown argument", () => {
    const run = printConfig("cert-renew.sh", {}, "--force");
    expect(run.status).toBe(2);
    expect(run.stdout).toBe("");
    expect(run.stderr).toMatch(/usage: \S*cert-renew\.sh \[--staging\]/);
  });
});

describe("bootstrap-secrets.sh", () => {
  // /etc/foa/vercel-urls.env: role and database per key, PgBouncer's port,
  // verify-full. --print-config names each password's secret file instead
  // of reading it.
  const vercelUrls = (host: string) => ({
    PROD_DATABASE_URL: `postgres://foa_app:<pg_prod_foa_app_password>@${host}:6432/foa?sslmode=verify-full`,
    PROD_DIRECT_URL: `postgres://foa_migrator:<pg_prod_foa_migrator_password>@${host}:6432/foa?sslmode=verify-full`,
    STAGING_DATABASE_URL: `postgres://staging_app:<pg_nonprod_staging_app_password>@${host}:6432/foa_staging?sslmode=verify-full`,
    STAGING_DIRECT_URL: `postgres://staging_migrator:<pg_nonprod_staging_migrator_password>@${host}:6432/foa_staging?sslmode=verify-full`,
    PREVIEW_DATABASE_URL: `postgres://nonprod_app:<pg_nonprod_nonprod_app_password>@${host}:6432/foa_pr?sslmode=verify-full`,
    PREVIEW_DIRECT_URL: `postgres://nonprod_migrator:<pg_nonprod_nonprod_migrator_password>@${host}:6432/foa_pr?sslmode=verify-full`,
  });
  const urlKeys = (config: Record<string, string>) =>
    Object.keys(config).filter((name) => name.endsWith("_URL"));

  it("writes the Vercel URLs for db.friendsofanimals.dev by default", () => {
    const run = printConfig("bootstrap-secrets.sh");
    expect(run).toMatchObject({
      status: 0,
      config: {
        domain: PRODUCTION_HOST,
        file: "/etc/foa/vercel-urls.env",
        ...vercelUrls(PRODUCTION_HOST),
      },
    });
    expect(urlKeys(run.config)).toEqual(
      Object.keys(vercelUrls(PRODUCTION_HOST))
    );
  });

  it("takes the host from FOA_DB_DOMAIN", () => {
    expect(
      printConfig("bootstrap-secrets.sh", { FOA_DB_DOMAIN: "db.example.test" })
    ).toMatchObject({
      status: 0,
      config: { domain: "db.example.test", ...vercelUrls("db.example.test") },
    });
  });
});

describe("smoke-test.sh", () => {
  it("checks db.friendsofanimals.dev:6432 with the URLs from /etc/foa/vercel-urls.env by default", () => {
    expect(printConfig("smoke-test.sh")).toMatchObject({
      status: 0,
      config: {
        domain: PRODUCTION_HOST,
        port: "6432",
        urls: "/etc/foa/vercel-urls.env",
      },
    });
  });

  it("takes the host from FOA_DB_DOMAIN", () => {
    expect(
      printConfig("smoke-test.sh", { FOA_DB_DOMAIN: "db.example.test" })
    ).toMatchObject({
      status: 0,
      config: { domain: "db.example.test", port: "6432" },
    });
  });
});
