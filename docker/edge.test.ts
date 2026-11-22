// The TLS edge (#118): Caddy on the host network in front of Umami
// (analytics.yml) and GlitchTip (errors.yml), plus port 80 for lego's
// PgBouncer certificate renewals. Docker can't run here, so these tests
// read edge.yml and caddy/Caddyfile.

import { describe, expect, it } from "vitest";
import { umamiRewrites } from "../src/lib/analytics/umami";
import { parseDsn } from "../src/lib/observability/config";
import { envelopeUrl } from "../src/lib/observability/envelope";
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
const isSnippet = (key: string) => key.startsWith("(");

/** A named matcher's lines in a site, without its braces. */
function matcher(address: string, name: string): string[] {
  const lines = site(address);
  const at = lines.indexOf(`${name} {`);
  if (at === -1) return [];
  return lines.slice(at + 1, lines.indexOf("}", at));
}

/**
 * Whether a site's log_skip matchers drop a request from its access log.
 * Reads the `method`, `path` and `path_regexp` lines Caddy ANDs together
 * in a named matcher; any other line fails, so the test can't pass on a
 * matcher it doesn't understand.
 */
function skipped(address: string, method: string, uri: string): boolean {
  const path = uri.split("?")[0] ?? "";
  const names = site(address)
    .filter((line) => line.startsWith("log_skip "))
    .map((line) => line.replace(/^log_skip /, ""));
  return names.some((name) => {
    const conditions = matcher(address, name);
    if (conditions.length === 0) throw new Error(`no matcher ${name}`);
    return conditions.every((condition) => {
      const [kind, ...args] = condition.split(/\s+/);
      if (kind === "method") return args.includes(method);
      if (kind === "path") return args.includes(path);
      if (kind === "path_regexp" && args.length === 1) {
        return new RegExp(args[0] ?? "").test(path);
      }
      throw new Error(`${name}: can't read "${condition}"`);
    });
  });
}

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
    // /metrics: Caddy logs every other admin request at info, which would
    // put a line in journald every 30 s.
    expect(caddyText).toMatch(/^ {4}restart: unless-stopped$/m);
    expect(oneLine(caddyText)).toMatch(
      /test: \["CMD", "curl", "-fsS", "-o", "\/dev\/null", "--unix-socket", "\/config\/admin\.sock", "http:\/\/localhost\/metrics"\]/
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
    expect(
      [...caddyfile.keys()]
        .filter((key) => key !== "" && !isSnippet(key))
        .sort()
    ).toEqual([ERRORS, DB, STATS].sort());
  });

  it("proxies stats to Umami's fixed address on the db bridge", () => {
    expect(site(STATS)).toContain("reverse_proxy 10.112.12.30:3000 {");
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
    expect(stats).toContain("reverse_proxy 10.112.12.30:3000 {");
  });

  it("is the file analytics-bootstrap.sh creates once the login is replaced", () => {
    expect(read("./scripts/analytics-bootstrap.sh")).toMatch(
      new RegExp(`^GATE_FILE=${GATE_DIR}/stats$`, "m")
    );
  });
});

describe("the visitor address Umami sees", () => {
  // Umami takes the visitor's address from CLIENT_IP_HEADER, and when that
  // header is missing, from the first of a list of CDN headers it finds.
  // Vercel's rewrite sets X-Real-IP to the visitor's address, replacing
  // whatever the browser sent; any other header in Umami's list that a
  // browser adds would take its place. That isn't all: Umami 3.5.0 prefers
  // an `ip` in the /api/send body, and a request sent to stats.* directly
  // sets its own X-Real-IP. Only the counts are at stake (README.md).
  const proxy = () => {
    const stats = site(STATS);
    const at = stats.indexOf("reverse_proxy 10.112.12.30:3000 {");
    const end = stats.indexOf("}", at);
    return stats.slice(at + 1, end);
  };

  it.each([
    "CF-Connecting-IP",
    "True-Client-IP",
    "X-Client-IP",
    "Fastly-Client-IP",
    "X-Nf-Client-Connection-Ip",
    "Do-Connecting-Ip",
  ])("strips a client-supplied %s before proxying to Umami", (header) => {
    expect(proxy()).toContain(`header_up -${header}`);
  });

  it("passes X-Real-IP through untouched, the header Umami reads", () => {
    expect(proxy().filter((line) => /x-real-ip/i.test(line))).toEqual([]);
    expect(
      read("./analytics.yml")
        .split("\n")
        .filter((line) => /CLIENT_IP_HEADER:/.test(line))
        .map((line) => line.trim())
    ).toEqual(["CLIENT_IP_HEADER: x-real-ip"]);
  });
});

describe("Caddy's access logs", () => {
  const snippet = caddyfile.get("(access_log)") ?? [];
  const filter = caddyfile.get("(no_visitor)") ?? [];

  // Headers that carry the visitor's address, location or page. Vercel's
  // rewrite adds the first twelve on every page view; Referer is the page.
  // Caddy logs every request header but Cookie and Authorization.
  const VISITOR_HEADERS = [
    "X-Real-Ip",
    "X-Forwarded-For",
    "Forwarded",
    "X-Vercel-Forwarded-For",
    "X-Vercel-Ip-Continent",
    "X-Vercel-Ip-Country",
    "X-Vercel-Ip-Country-Region",
    "X-Vercel-Ip-City",
    "X-Vercel-Ip-Postal-Code",
    "X-Vercel-Ip-Latitude",
    "X-Vercel-Ip-Longitude",
    "X-Vercel-Ip-Timezone",
    "Referer",
  ];

  it("is one snippet, sharing the visitor filter with Caddy's own log", () => {
    expect([...caddyfile.keys()].filter(isSnippet)).toEqual([
      "(no_visitor)",
      "(access_log)",
    ]);
  });

  it.each([STATS, ERRORS])("%s writes it", (name) => {
    expect(site(name)).toContain("import access_log");
    expect(site(name).filter((line) => /^log\b/.test(line))).toEqual([]);
  });

  it("is JSON on stdout", () => {
    // stdout goes to journald through the container's logging driver
    // (edge.yml); Caddy's own log stays on stderr.
    expect(snippet).toEqual([
      "log {",
      "output stdout",
      "import no_visitor",
      "}",
    ]);
    expect(filter.slice(0, 3)).toEqual([
      "format filter {",
      "wrap json",
      "fields {",
    ]);
  });

  it("filters Caddy's error log too, which logs a skipped request when its upstream fails", () => {
    // A 502 from a stopped Umami or GlitchTip goes to the default logger
    // (stderr) with the request's headers, X-Real-Ip and Referer included.
    const global = caddyfile.get("") ?? [];
    const at = global.indexOf("log default {");
    expect(at).toBeGreaterThan(-1);
    expect(global.slice(at, at + 4)).toEqual([
      "log default {",
      "output stderr",
      "import no_visitor",
      "}",
    ]);
  });

  it("never holds the visitor's address, location or page (no PII in logs)", () => {
    const fields = filter.slice(
      filter.indexOf("fields {") + 1,
      filter.indexOf("}", filter.indexOf("fields {"))
    );
    expect(fields).toEqual(
      VISITOR_HEADERS.map((header) => `request>headers>${header} delete`)
    );
    // Cookie, Set-Cookie and Authorization stay REDACTED.
    expect(caddyfileText).not.toMatch(/log_credentials/);
  });

  // Methods a request through Vercel can carry: its rewrites match the
  // path only, so they forward every method and the query string.
  const METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"];
  const PROBE = "?x=%24%7Bjndi:ldap://a/b%7D";

  it("skips every request the site's /stats rewrites proxy, whatever the method", () => {
    // Every visitor's page view, from Vercel's shared egress: never kept,
    // and never counted towards a CrowdSec ban (which would cut Vercel off
    // from PgBouncer too). A method or query a visitor picks mustn't make
    // Caddy log one of them with Vercel's address.
    const proxied = umamiRewrites(`https://${STATS}`).map(
      (rewrite) => new URL(rewrite.destination).pathname
    );
    expect(proxied).toEqual(["/script.js", "/api/send"]);
    for (const path of proxied) {
      for (const method of METHODS) {
        expect(skipped(STATS, method, path), `${method} ${path}`).toBe(true);
        expect(skipped(STATS, method, path + PROBE), `${method} ${path}?`).toBe(
          true
        );
      }
    }
  });

  it("logs everything else on stats", () => {
    for (const uri of ["/", "/api/websites", "/script.js/", "/api/send/x"]) {
      for (const method of METHODS) {
        expect(skipped(STATS, method, uri), `${method} ${uri}`).toBe(false);
      }
    }
  });

  it("skips every request to the Sentry envelope path on errors, whatever the method", () => {
    const dsn = parseDsn(`https://key@${ERRORS}/1`);
    expect(dsn).toBeDefined();
    const path = new URL(envelopeUrl(dsn!)).pathname;
    for (const method of METHODS) {
      expect(skipped(ERRORS, method, path), `${method} ${path}`).toBe(true);
      expect(skipped(ERRORS, method, path + PROBE), `${method} ${path}?`).toBe(
        true
      );
    }
  });

  it("logs everything else on errors", () => {
    for (const uri of [
      "/",
      "/api/1/store/",
      "/api/0/projects/",
      "/api/x/envelope/",
    ]) {
      for (const method of METHODS) {
        expect(skipped(ERRORS, method, uri), `${method} ${uri}`).toBe(false);
      }
    }
  });
});

describe("CrowdSec on Caddy's access log", () => {
  const install = read("./scripts/install-crowdsec.sh");
  const acquis = lines(read("./crowdsec/acquis-foa-caddy.yaml"));

  it("acquires foa-caddy's access log from journald, stdout lines only", () => {
    // Docker's journald driver logs stdout at PRIORITY 6 and stderr at 3.
    // journalctl, not the docker source: no dockerd stream per line.
    expect(acquis).toEqual([
      "source: journalctl",
      "journalctl_filter:",
      '  - "CONTAINER_NAME=foa-caddy"',
      '  - "PRIORITY=6"',
      '  - "--output=cat"',
      "labels:",
      "  type: caddy",
    ]);
  });

  it("gets bare JSON lines from journalctl, which crowdsecurity/caddy-logs parses", () => {
    // CrowdSec 1.7 and 1.8 run `journalctl --follow -n 0` plus the
    // journalctl_filter entries (getCommandArgs in
    // pkg/acquisition/modules/journalctl/run.go), with no output mode of
    // their own. journalctl's default prefixes each line with
    // `Nov 22 05:11:28 <host> foa-caddy[<pid>]: `, and the caddy parser's
    // UnmarshalJSON fails on every one of them.
    const filters = block(acquis, /^journalctl_filter:$/).map(
      (line) => JSON.parse(line.trim().replace(/^- /, "")) as string
    );
    const argv = ["--follow", "-n", "0", ...filters];
    expect(argv.filter((arg) => /^(-o|--output)\b/.test(arg))).toEqual([
      "--output=cat",
    ]);
    expect(filters.filter((arg) => !arg.startsWith("-"))).toEqual([
      "CONTAINER_NAME=foa-caddy",
      "PRIORITY=6",
    ]);
  });

  it("installs the caddy collection and the acquisition", () => {
    expect(install).toMatch(
      /^cscli collections install crowdsecurity\/caddy$/m
    );
    expect(install).toMatch(
      /^install -m 0644 "\$SRC\/acquis-foa-caddy\.yaml" \/etc\/crowdsec\/acquis\.d\/foa-caddy\.yaml$/m
    );
  });

  it("only installs files that exist under docker/crowdsec", () => {
    const sources = [...install.matchAll(/"\$SRC\/([^"]+)"/g)]
      .map(([, file]) => file ?? "")
      .filter((file) => !file.includes("$"));
    expect(sources.length).toBeGreaterThan(0);
    for (const file of sources) {
      expect(() => read(`./crowdsec/${file}`), file).not.toThrow();
    }
  });
});

describe("abuse control on the public stats and errors sites", () => {
  const readme = read("./README.md");
  const section = (from: string, to: string) =>
    readme.slice(
      readme.indexOf(from),
      readme.indexOf(to, readme.indexOf(from))
    );

  it("is CrowdSec's HTTP scenarios, not a Caddy rate limit, as the README says", () => {
    // The stock image has no rate-limit module, and nearly every request
    // comes from Vercel's few shared egress addresses: a per-address limit
    // would throttle every visitor at once.
    expect(caddyfileText).not.toMatch(/rate_limit/);
    expect(caddyText).toMatch(/^ {4}image: caddy:2\.11\.9$/m);
    const edge = section("## Edge (Caddy)", "\n## ");
    expect(edge).toContain("**Abuse control**");
    expect(edge).toContain("crowdsecurity/caddy");
    expect(section("## TODO and owner actions", "\n## ")).toContain(
      "**Edge rate limit**"
    );
  });
});
