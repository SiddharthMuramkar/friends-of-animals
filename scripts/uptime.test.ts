import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function workflow(): string {
  return readFileSync(
    new URL("../.github/workflows/uptime.yml", import.meta.url),
    "utf8"
  );
}

describe("the production uptime workflow", () => {
  it("runs every five minutes or on demand with no token access", () => {
    const config = workflow();
    expect(config).toMatch(/^name: Uptime$/m);
    expect(config).toMatch(
      /^on:\n  schedule:\n    - cron: "\*\/5 \* \* \* \*"\n  workflow_dispatch:$/m
    );
    expect(config).toMatch(/^permissions: \{\}$/m);
    expect(config).toMatch(/^concurrency: uptime$/m);
    expect(config).toMatch(/^    timeout-minutes: [1-5]$/m);
    expect(config).not.toMatch(/\bsecrets\./);
  });

  it("probes the live app, database listener, and worker", () => {
    const config = workflow();
    expect(config).toMatch(
      /curl -fsS --max-time 20[^\n]+https:\/\/friendsofanimals\.dev\/api\/health\s/
    );
    expect(config).toContain("nc -z -w5 db.friendsofanimals.dev 6432");
    expect(config).toMatch(
      /curl -fsS --max-time 20[^\n]+https:\/\/friendsofanimals\.dev\/api\/health\/worker\s/
    );
    expect(config).not.toMatch(/\bcontinue-on-error:/);
  });
});
