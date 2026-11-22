import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) =>
  readFileSync(new URL(path, import.meta.url), "utf8");

const compose = read("./analytics.yml");
const pgHba = read("./postgres/pg_hba.prod.conf");

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

const top = lines(compose);
const services = block(top, /^services:$/);
const service = (name: string) =>
  block(services, new RegExp(`^ {2}${name}:$`)).join("\n");
/** `text` on one line, with flow sequences as `["a", "b"]` however wrapped. */
const oneLine = (text: string) =>
  text.replace(/\s+/g, " ").replace(/\[ /g, "[").replace(/,? \]/g, "]");
const serviceNames = services
  .filter((line) => indent(line) === 2)
  .map((line) => line.trim().replace(/:$/, ""));

describe("docker/analytics.yml", () => {
  it("is its own Compose project with Umami only", () => {
    expect(top).toContain("name: foa-analytics");
    expect(serviceNames.sort()).toEqual(["umami"]);
  });

  it("pins every image to an exact version", () => {
    const images = top.filter((line) => /^\s+image:/.test(line));
    expect(images).toHaveLength(1);
    for (const image of images) {
      expect(image).toMatch(/:\d+(?:\.\d+){2}$/);
    }
    expect(service("umami")).toMatch(
      /image: ghcr\.io\/umami-software\/umami:\d+\.\d+\.\d+$/m
    );
  });

  it("checks Umami's heartbeat and restarts it", () => {
    const umami = service("umami");
    expect(oneLine(umami)).toMatch(
      /test: \["CMD", "curl", "-fsS", "http:\/\/127\.0\.0\.1:3000\/api\/heartbeat"\]/
    );
    expect(umami).toMatch(/^ {4}restart: unless-stopped$/m);
  });

  it.each(["umami"])("limits %s's CPU and memory", (name) => {
    expect(service(name)).toMatch(/^ {4}cpus: [\d.]+$/m);
    expect(service(name)).toMatch(/^ {4}mem_limit: \d+[mg]$/m);
  });

  it("publishes no port beyond 127.0.0.1", () => {
    const published = top.flatMap((line, i) =>
      /^\s+ports:$/.test(line) ? block(top.slice(i), /ports:$/) : []
    );
    for (const port of published) {
      expect(port).toMatch(/^\s+- "127\.0\.0\.1:/);
    }
  });

  it("publishes no port at all: Caddy on the host reaches Umami on db", () => {
    expect(top.some((line) => /^\s+(ports|expose):/.test(line))).toBe(false);
  });

  it("keeps its data in pg-prod: no database and no volume of its own", () => {
    expect(top.some((line) => line.startsWith("volumes:"))).toBe(false);
    expect(top.some((line) => /^\s+volumes:/.test(line))).toBe(false);
    expect(compose).not.toMatch(/image: .*postgres/);
    expect(compose).not.toMatch(/DATABASE_URL/);
    // DATABASE_URL and the app secrets come from the env file
    // analytics-bootstrap.sh writes, never from this file.
    expect(service("umami")).toMatch(
      /^ {4}env_file: \/etc\/foa\/analytics\.env$/m
    );
  });

  it("joins the database network at the address pg_hba lets in", () => {
    expect(block(block(top, /^networks:$/), /^ {2}db:$/)).toEqual([
      "    name: foa-vps_db",
      "    external: true",
    ]);
    expect(
      block(block(lines(service("umami")), /^ {4}networks:$/), /db:$/)
    ).toEqual(["        ipv4_address: 10.112.12.30"]);
    // db only: Caddy (edge.yml) proxies stats.friendsofanimals.dev there.
    expect(
      block(top, /^networks:$/).filter((line) => indent(line) === 2)
    ).toEqual(["  db:"]);
    expect(
      block(lines(service("umami")), /^ {4}networks:$/).filter(
        (line) => indent(line) === 6
      )
    ).toEqual(["      db:"]);
  });

  it("logs through the shared journald anchor, like edge.yml and errors.yml", () => {
    // #66: every Compose file here logs to journald through one anchor.
    expect(["x-logging: &logging", ...block(top, /^x-logging:/)]).toEqual([
      "x-logging: &logging",
      "  driver: journald",
      "  options:",
      '    tag: "{{.Name}}"',
    ]);
    expect(service("umami")).toMatch(/^ {4}logging: \*logging$/m);
    expect(compose).not.toMatch(/json-file|max-size|max-file/);
  });

  it("has no Cloudflare Tunnel: no cloudflared service, network or secret", () => {
    expect(top.join("\n")).not.toMatch(/cloudflare|tunnel/i);
    expect(top.some((line) => line.startsWith("secrets:"))).toBe(false);
  });
});

describe("pg_hba.prod.conf for Umami", () => {
  const rules = lines(pgHba).map((line) => line.trim().split(/\s+/).join(" "));

  it("lets only the Umami container log in as umami, to umami", () => {
    const umami = rules.filter((rule) => / umami /.test(rule));
    expect(umami).toEqual(["host umami umami 10.112.12.30/32 scram-sha-256"]);
  });

  it("puts that rule above the final reject", () => {
    const allow = rules.indexOf(
      "host umami umami 10.112.12.30/32 scram-sha-256"
    );
    const reject = rules.indexOf("host all all 0.0.0.0/0 reject");
    expect(allow).toBeGreaterThan(-1);
    expect(allow).toBeLessThan(reject);
  });
});
