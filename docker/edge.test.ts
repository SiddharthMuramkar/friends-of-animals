// The TLS edge (#118): Caddy on the host network in front of Umami
// (analytics.yml) and GlitchTip (errors.yml), plus port 80 for lego's
// PgBouncer certificate renewals. Docker can't run here, so these tests
// read edge.yml and caddy/Caddyfile.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) =>
  readFileSync(new URL(path, import.meta.url), "utf8");

/** Lines without comments and blank lines. */
const lines = (text: string) =>
  text
    .split("\n")
    .map((line) => line.replace(/\s+#.*$/, ""))
    .filter((line) => line.trim() !== "" && !line.trim().startsWith("#"));

const indent = (line: string) => line.length - line.trimStart().length;

/** The lines nested under the first line matching `key` (by indentation). */
function block(text: string[], key: RegExp): string[] {
  const start = text.findIndex((line) => key.test(line));
  if (start === -1) return [];
  const depth = indent(text[start] ?? "");
  const end = text.findIndex((line, i) => i > start && indent(line) <= depth);
  return text.slice(start + 1, end === -1 ? undefined : end);
}

/** `text` on one line, with flow sequences as `["a", "b"]` however wrapped. */
const oneLine = (text: string) =>
  text.replace(/\s+/g, " ").replace(/\[ /g, "[").replace(/,? \]/g, "]");

/** The anchor every Compose file here defines, word for word (#66). */
const LOGGING_ANCHOR = [
  "x-logging: &logging",
  "  driver: journald",
  "  options:",
  '    tag: "{{.Name}}"',
];

const composeText = read("./edge.yml");
const compose = lines(composeText);
const services = block(compose, /^services:$/);
const serviceNames = services
  .filter((line) => indent(line) === 2)
  .map((line) => line.trim().replace(/:$/, ""));
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

  it("restarts, checks the admin API and has hard memory limits", () => {
    expect(caddyText).toMatch(/^ {4}restart: unless-stopped$/m);
    expect(oneLine(caddyText)).toMatch(
      /test: \["CMD", "wget", "-q", "-O", "\/dev\/null", "http:\/\/127\.0\.0\.1:2019\/config\/"\]/
    );
    expect(caddyText).toMatch(/^ {4}mem_limit: 256m$/m);
    expect(caddyText).toMatch(/^ {4}memswap_limit: 256m$/m);
    expect(caddyText).toMatch(/^ {4}oom_score_adj: 500$/m);
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

  it("keeps the admin API on loopback: Caddy shares the host's network", () => {
    expect(site("")).toContain("admin 127.0.0.1:2019");
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
