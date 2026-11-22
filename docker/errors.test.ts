// GlitchTip (#66, #118): the error tracker behind
// https://errors.friendsofanimals.dev, in its own Compose project with its
// own small Postgres. Docker can't run here, so these tests read errors.yml.

import { describe, expect, it } from "vitest";
import {
  LOGGING_ANCHOR,
  block,
  lines,
  serviceBlock,
  serviceNames as listServices,
  readDocker,
} from "./compose-test-helpers";

const composeText = readDocker("./errors.yml");

const compose = lines(composeText);
const serviceNames = listServices(compose);
const service = (name: string) => serviceBlock(compose, name);
const glitchtip = service("glitchtip");
const postgres = service("glitchtip-pg");

describe("docker/errors.yml", () => {
  it("is its own Compose project with GlitchTip and its database", () => {
    expect(compose).toContain("name: foa-errors");
    expect(serviceNames.sort()).toEqual(["glitchtip", "glitchtip-pg"]);
    expect(glitchtip).toMatch(/^ {4}container_name: foa-glitchtip$/m);
    expect(postgres).toMatch(/^ {4}container_name: foa-glitchtip-pg$/m);
  });

  it("pins GlitchTip to 7.0.0 and Postgres to an exact version", () => {
    expect(glitchtip).toMatch(/^ {4}image: glitchtip\/glitchtip:7\.0\.0$/m);
    expect(postgres).toMatch(/^ {4}image: postgres:\d+\.\d+-alpine$/m);
  });

  it("uses Postgres as queue and cache: no Valkey or Redis", () => {
    expect(glitchtip).toMatch(/^ {6}VALKEY_URL: ""$/m);
    expect(composeText).not.toMatch(/image: .*(valkey|redis)/);
    expect(composeText).not.toMatch(/REDIS_URL/);
  });

  it("gives Postgres the locks GlitchTip's partitioned tables need", () => {
    expect(postgres).toMatch(
      /^ {6}- -c\n {6}- max_locks_per_transaction=512$/m
    );
  });

  it("caps memory, and the kernel kills it before the databases", () => {
    expect(glitchtip).toMatch(/^ {4}mem_limit: 1g$/m);
    expect(glitchtip).toMatch(/^ {4}memswap_limit: 1g$/m);
    expect(glitchtip).toMatch(/^ {4}oom_score_adj: 500$/m);
    expect(postgres).toMatch(/^ {4}mem_limit: \d+m$/m);
    expect(postgres).toMatch(/^ {4}oom_score_adj: 500$/m);
  });

  it("publishes no port: Caddy reaches GlitchTip on its bridge", () => {
    expect(composeText).not.toMatch(/^\s+(ports|expose):/m);
    expect(glitchtip).toMatch(/ipv4_address: 10\.112\.13\.10\b/);
    expect(glitchtip).toMatch(/^ {6}PORT: "8000"$/m);
    expect(glitchtip).toMatch(
      /^ {6}GLITCHTIP_DOMAIN: https:\/\/errors\.friendsofanimals\.dev$/m
    );
  });

  it("reads its secrets from files under /etc/foa/secrets", () => {
    expect(glitchtip).toMatch(
      /^ {4}env_file: \/etc\/foa\/secrets\/glitchtip\.env$/m
    );
    expect(postgres).toMatch(
      /^ {6}POSTGRES_PASSWORD_FILE: \/run\/secrets\/pg_password$/m
    );
    expect(postgres).toMatch(
      /^ {6}- \/etc\/foa\/secrets\/glitchtip_pg_password:\/run\/secrets\/pg_password:ro$/m
    );
    // The values themselves never appear in this file.
    expect(composeText).not.toMatch(
      /^\s+(SECRET_KEY|DATABASE_URL|POSTGRES_PASSWORD):/m
    );
  });

  it("keeps its data under /var/lib/foa/glitchtip", () => {
    expect(postgres).toMatch(
      /^ {6}- \/var\/lib\/foa\/glitchtip\/pg:\/var\/lib\/postgresql$/m
    );
    expect(glitchtip).toMatch(
      /^ {6}- \/var\/lib\/foa\/glitchtip\/uploads:\/code\/uploads$/m
    );
  });

  it("turns off sign-up, new organisations and the Django admin", () => {
    for (const flag of [
      "ENABLE_USER_REGISTRATION",
      "ENABLE_ORGANIZATION_CREATION",
      "ENABLE_ADMIN",
    ]) {
      expect(glitchtip).toMatch(new RegExp(`^ {6}${flag}: "False"$`, "m"));
    }
  });

  it("is health-checked, restarts, and waits for its database", () => {
    for (const config of [glitchtip, postgres]) {
      expect(config).toMatch(/^ {4}restart: unless-stopped$/m);
      expect(config).toMatch(/^ {4}healthcheck:$/m);
    }
    expect(glitchtip).toMatch(
      /^ {6}glitchtip-pg: \{ condition: service_healthy \}$/m
    );
  });

  it("gains no new privileges in either container", () => {
    for (const config of [glitchtip, postgres]) {
      expect(block(config.split("\n"), /^ {4}security_opt:$/)).toEqual([
        "      - no-new-privileges:true",
      ]);
    }
  });

  it("runs GlitchTip with no capabilities: the image's user is app, not root", () => {
    expect(block(glitchtip.split("\n"), /^ {4}cap_drop:$/)).toEqual([
      "      - ALL",
    ]);
    expect(glitchtip).not.toMatch(/^ {4}cap_add:/m);
  });

  it("gives Postgres only the capabilities its entrypoint needs", () => {
    // The entrypoint starts as root: it chowns and chmods the data
    // directory, reads the 0400 password file, then drops to postgres.
    expect(block(postgres.split("\n"), /^ {4}cap_drop:$/)).toEqual([
      "      - ALL",
    ]);
    expect(
      block(postgres.split("\n"), /^ {4}cap_add:$/)
        .map((line) => line.trim())
        .sort()
    ).toEqual(
      ["- CHOWN", "- DAC_OVERRIDE", "- FOWNER", "- SETGID", "- SETUID"].sort()
    );
  });

  it("keeps both on the R-I01 network: foa-errors, 10.112.13.0/24", () => {
    expect(block(compose, /^networks:$/)).toEqual([
      "  errors:",
      "    name: foa-errors",
      "    driver: bridge",
      "    driver_opts:",
      "      com.docker.network.bridge.name: br-foa-errors",
      "    ipam:",
      "      config:",
      "        - subnet: 10.112.13.0/24",
    ]);
    expect(glitchtip).toMatch(
      /^ {6}errors: \{ ipv4_address: 10\.112\.13\.10 \}$/m
    );
    expect(postgres).toMatch(
      /^ {6}errors: \{ ipv4_address: 10\.112\.13\.11 \}$/m
    );
  });

  it("logs through the shared journald anchor", () => {
    expect(["x-logging: &logging", ...block(compose, /^x-logging:/)]).toEqual(
      LOGGING_ANCHOR
    );
    for (const config of [glitchtip, postgres]) {
      expect(config).toMatch(/^ {4}logging: \*logging$/m);
    }
    expect(composeText).not.toMatch(/json-file|max-size|max-file/);
  });
});

describe("README.md, Errors (GlitchTip)", () => {
  const readme = readDocker("./README.md");
  const start = readme.indexOf("\n## Errors (GlitchTip)\n");
  const section = readme.slice(start, readme.indexOf("\n## ", start + 1));
  /** Lines of the section's shell blocks, trimmed, comments dropped. */
  const commands = [...section.matchAll(/```sh\n([\s\S]*?)```/g)]
    .flatMap(([, body]) => lines(body ?? ""))
    .map((line) => line.trim());
  const at = (command: string) => commands.indexOf(command);

  it("creates the superuser on a new host before GlitchTip serves anything", () => {
    // The first account to sign up becomes superuser, and Caddy already
    // routes errors.friendsofanimals.dev: the web server must not run
    // until the owner's account exists.
    expect(start).toBeGreaterThan(-1);
    const steps = [
      "docker compose -f docker/errors.yml up -d --wait glitchtip-pg",
      "docker compose -f docker/errors.yml run --rm glitchtip ./manage.py migrate",
      "docker compose -f docker/errors.yml run --rm glitchtip ./manage.py createsuperuser",
      "docker compose -f docker/errors.yml up -d --wait",
    ].map(at);
    expect(steps.every((index) => index > -1)).toBe(true);
    expect([...steps].sort((a, b) => a - b)).toEqual(steps);
  });

  it("covers losing GlitchTip's database, which no backup restores", () => {
    expect(section).toMatch(/\/var\/lib\/foa\/glitchtip\/pg/);
    expect(section).not.toMatch(/straight after the first start/);
  });
});
