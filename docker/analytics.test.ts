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
const serviceNames = services
  .filter((line) => indent(line) === 2)
  .map((line) => line.trim().replace(/:$/, ""));

describe("docker/analytics.yml", () => {
  it("is its own Compose project with Umami and the tunnel only", () => {
    expect(top).toContain("name: foa-analytics");
    expect(serviceNames.sort()).toEqual(["cloudflared", "umami"]);
  });

  it("pins every image to an exact version", () => {
    const images = top.filter((line) => /^\s+image:/.test(line));
    expect(images).toHaveLength(2);
    for (const image of images) {
      expect(image).toMatch(/:\d+(?:\.\d+){2}$/);
    }
    expect(service("umami")).toMatch(
      /image: ghcr\.io\/umami-software\/umami:\d+\.\d+\.\d+$/m
    );
    expect(service("cloudflared")).toMatch(
      /image: cloudflare\/cloudflared:\d{4}\.\d+\.\d+$/m
    );
  });

  it("checks Umami's heartbeat and restarts it", () => {
    const umami = service("umami");
    expect(umami).toMatch(
      /test: \["CMD", "curl", "-fsS", "http:\/\/127\.0\.0\.1:3000\/api\/heartbeat"\]/
    );
    expect(umami).toMatch(/^ {4}restart: unless-stopped$/m);
  });

  it("checks the tunnel's edge connection and restarts it", () => {
    const tunnel = service("cloudflared");
    expect(tunnel).toMatch(
      /test: \["CMD", "cloudflared", "tunnel", "--metrics", "127\.0\.0\.1:\d+", "ready"\]/
    );
    expect(tunnel).toMatch(/^ {4}restart: unless-stopped$/m);
  });

  it.each(["umami", "cloudflared"])("limits %s's CPU and memory", (name) => {
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

  it("keeps its data in pg-prod: no database and no volume of its own", () => {
    expect(top.some((line) => /^volumes:/.test(line))).toBe(false);
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
    expect(service("cloudflared")).not.toMatch(/^ {6}db:/m);
  });

  it("reads the tunnel token from a secret file, never the environment", () => {
    const tunnel = service("cloudflared");
    expect(tunnel).toMatch(
      /"--token-file", "\/run\/secrets\/cloudflared_tunnel_token"/
    );
    expect(compose).not.toMatch(/TUNNEL_TOKEN[^_]|"--token"/);
    expect(
      block(block(top, /^secrets:$/), /^ {2}cloudflared_tunnel_token:$/)
    ).toEqual(["    file: /etc/foa/secrets/cloudflared_tunnel_token"]);
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
