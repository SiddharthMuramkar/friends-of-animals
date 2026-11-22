// The TLS edge (#118): Caddy on the host network in front of Umami
// (analytics.yml) and GlitchTip (errors.yml), plus port 80 for lego's
// PgBouncer certificate renewals. Docker can't run here, so these tests
// read edge.yml and caddy/Caddyfile.

import { describe, expect, it } from "vitest";
import {
  LOGGING_ANCHOR,
  block,
  lines,
  oneLine,
  serviceNames as listServices,
  readDocker as read,
} from "./compose-test-helpers";

const composeText = read("./edge.yml");
const compose = lines(composeText);
const services = block(compose, /^services:$/);
const serviceNames = listServices(compose);
const caddy = block(services, /^ {2}caddy:$/);
const caddyText = caddy.join("\n");
const volumes = block(caddy, /^ {4}volumes:$/).map((line) =>
  line.trim().replace(/^- /, "")
);

/**
 * The top-level blocks of a Caddyfile by their first line: "" for the
 * global options, else the site addresses. Lines are trimmed; a nested
 * block keeps its braces.
 */
function caddyBlocks(text: string): Map<string, string[]> {
  const result = new Map<string, string[]>();
  let current: string | undefined;
  for (const line of lines(text)) {
    if (current === undefined) {
      const head = /^(\S.*?)?\s*\{$/.exec(line);
      if (head) {
        current = head[1] ?? "";
        result.set(current, []);
      }
    } else if (line === "}") {
      current = undefined;
    } else {
      result.get(current)?.push(line.trim());
    }
  }
  return result;
}

const caddyfileText = read("./caddy/Caddyfile");
const caddyfile = caddyBlocks(caddyfileText);
const site = (address: string) => caddyfile.get(address) ?? [];

const STATS = "stats.friendsofanimals.dev";
const ERRORS = "errors.friendsofanimals.dev";
const DB = "http://db.friendsofanimals.dev, http://db.shipped-it.dev";

describe("docker/edge.yml", () => {
  it("is its own Compose project with Caddy only", () => {
    expect(compose).toContain("name: foa-edge");
    expect(serviceNames).toEqual(["caddy"]);
    expect(caddyText).toMatch(/^ {4}container_name: foa-caddy$/m);
  });

  it("pins Caddy to 2.11.9", () => {
    expect(caddyText).toMatch(/^ {4}image: caddy:2\.11\.9$/m);
  });

  it("binds 80 and 443 on the host network, so firewalld governs them", () => {
    expect(caddyText).toMatch(/^ {4}network_mode: host$/m);
    expect(caddyText).not.toMatch(/^ {4}(ports|networks):/m);
  });

  it("keeps certificates and ACME state in /var/lib/foa/caddy", () => {
    expect(volumes).toContain("/var/lib/foa/caddy/data:/data");
    expect(volumes).toContain("/var/lib/foa/caddy/config:/config");
  });

  it("mounts the caddy/ directory read-only, so a reload sees a pulled Caddyfile", () => {
    // A single-file bind mount keeps the inode it started with, and git
    // replaces files on checkout: `caddy reload` would read the old one.
    expect(volumes).toContain("./caddy:/etc/caddy:ro");
    expect(volumes.filter((volume) => /Caddyfile/.test(volume))).toEqual([]);
  });

  it("serves lego's webroot read-only", () => {
    expect(volumes).toContain("/var/lib/foa/acme-webroot:/srv/acme:ro");
  });

  it("restarts, checks the admin API over its socket and has hard limits", () => {
    expect(caddyText).toMatch(/^ {4}restart: unless-stopped$/m);
    expect(oneLine(caddyText)).toMatch(
      /test: \["CMD", "curl", "-fsS", "-o", "\/dev\/null", "--unix-socket", "\/config\/admin\.sock", "http:\/\/localhost\/config\/"\]/
    );
    expect(caddyText).toMatch(/^ {4}mem_limit: 256m$/m);
    expect(caddyText).toMatch(/^ {4}memswap_limit: 256m$/m);
    expect(caddyText).toMatch(/^ {4}oom_score_adj: 500$/m);
    expect(caddyText).toMatch(/^ {4}cpus: 0\.5$/m);
  });

  it("drops every capability but binding :80 and :443, and gains none", () => {
    // Root in the host's network namespace: Docker's defaults would include
    // NET_RAW there, enough to sniff the bridges' plaintext traffic.
    expect(block(caddy, /^ {4}cap_drop:$/)).toEqual(["      - ALL"]);
    expect(block(caddy, /^ {4}cap_add:$/)).toEqual([
      "      - NET_BIND_SERVICE",
    ]);
    expect(block(caddy, /^ {4}security_opt:$/)).toEqual([
      "      - no-new-privileges:true",
    ]);
  });

  it("runs read-only, writing only /data, /config and a tmpfs /tmp", () => {
    expect(caddyText).toMatch(/^ {4}read_only: true$/m);
    expect(block(caddy, /^ {4}tmpfs:$/)).toEqual(["      - /tmp"]);
    expect(volumes.filter((volume) => !volume.endsWith(":ro"))).toEqual([
      "/var/lib/foa/caddy/data:/data",
      "/var/lib/foa/caddy/config:/config",
    ]);
  });

  it("logs through the shared journald anchor", () => {
    expect(["x-logging: &logging", ...block(compose, /^x-logging:/)]).toEqual(
      LOGGING_ANCHOR
    );
    expect(caddyText).toMatch(/^ {4}logging: \*logging$/m);
    expect(composeText).not.toMatch(/json-file|max-size|max-file/);
  });
});

describe("docker/caddy/Caddyfile", () => {
  it("pins Let's Encrypt's production CA", () => {
    expect(site("")).toContain(
      "acme_ca https://acme-v02.api.letsencrypt.org/directory"
    );
    expect(lines(caddyfileText).join("\n")).not.toMatch(/staging/);
  });

  it("serves the admin API on a unix socket under /config, not TCP", () => {
    // On the host network a TCP admin port is reachable by every local
    // process; the socket is reachable by root (and this container) only.
    expect(site("")).toContain("admin unix//config/admin.sock|0600");
    expect(site("").filter((line) => line.startsWith("admin "))).toHaveLength(
      1
    );
    for (const text of [caddyfileText, composeText, read("./README.md")]) {
      expect(text).not.toMatch(/:2019\b/);
    }
  });

  it("is reloaded through that socket in the runbook", () => {
    expect(read("./README.md")).toContain(
      "docker exec foa-caddy caddy reload --config /etc/caddy/Caddyfile --address unix//config/admin.sock"
    );
    expect(composeText).toContain(
      "docker exec foa-caddy caddy reload --config /etc/caddy/Caddyfile --address unix//config/admin.sock"
    );
  });

  it("serves stats, errors and the db names, nothing else", () => {
    expect([...caddyfile.keys()].filter((key) => key !== "").sort()).toEqual(
      [ERRORS, DB, STATS].sort()
    );
  });

  it("proxies stats to Umami's fixed address on the db bridge", () => {
    expect(site(STATS)).toContain("reverse_proxy 10.112.12.30:3000");
    expect(read("./analytics.yml")).toMatch(
      /^ +ipv4_address: 10\.112\.12\.30$/m
    );
  });

  it("proxies errors to GlitchTip's fixed address on its own bridge", () => {
    expect(site(ERRORS)).toContain("reverse_proxy 10.112.13.10:8000");
    expect(read("./errors.yml")).toMatch(/ipv4_address: 10\.112\.13\.10\b/);
  });

  it.each([STATS, ERRORS])("%s sends HSTS and no Server header", (name) => {
    expect(site(name)).toContain(
      'Strict-Transport-Security "max-age=31536000"'
    );
    expect(site(name)).toContain("-Server");
  });

  it("answers the db names on port 80 only, with lego's challenge files", () => {
    // http:// so Caddy never manages a certificate for them: lego does, and
    // PgBouncer serves it on 6432 (TLS certificate in README.md).
    expect(site(DB)).toEqual([
      "handle /.well-known/acme-challenge/* {",
      "root * /srv/acme",
      "file_server",
      "}",
      "handle {",
      "respond 404",
      "}",
    ]);
  });
});

describe("the stats site's gate", () => {
  // Umami starts with the seeded login admin/umami, which everyone knows.
  // scripts/analytics-bootstrap.sh replaces it, and only then creates the
  // gate file; until that file exists, Caddy answers stats with a 503.
  const GATE_DIR = "/var/lib/foa/caddy/gates";

  it("is a host directory Caddy reads but can't write", () => {
    expect(volumes).toContain(`${GATE_DIR}:/srv/gates:ro`);
  });

  it("answers stats with a 503 while the gate file is missing", () => {
    const stats = site(STATS);
    const at = stats.indexOf("@closed not file {");
    expect(at).toBeGreaterThan(-1);
    expect(stats.slice(at, at + 5)).toEqual([
      "@closed not file {",
      "root /srv/gates",
      "try_files /stats",
      "}",
      "respond @closed 503",
    ]);
    expect(stats).toContain("reverse_proxy 10.112.12.30:3000");
  });

  it("is the file analytics-bootstrap.sh creates once the login is replaced", () => {
    expect(read("./scripts/analytics-bootstrap.sh")).toMatch(
      new RegExp(`^GATE_FILE=${GATE_DIR}/stats$`, "m")
    );
  });
});
