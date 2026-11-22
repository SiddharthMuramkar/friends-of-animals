import { execFile } from "node:child_process";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { createServer as createTcpServer } from "node:net";
import { describe, expect, it } from "vitest";

const HTTP_PROBES = [
  { name: "Check the public app", path: "/api/health" },
  { name: "Check the production worker", path: "/api/health/worker" },
];

function workflow(): string {
  return readFileSync(
    new URL("../.github/workflows/uptime.yml", import.meta.url),
    "utf8"
  );
}

const DATABASE_PROBE = "Check the database listener";

function steps(): string[] {
  return workflow()
    .split(/^      - name: /m)
    .slice(1);
}

function step(name: string): string {
  const entry = steps().find((block) => block.startsWith(`${name}\n`));
  if (!entry) throw new Error(`Missing step ${name}`);
  return entry;
}

function runScript(name: string): string {
  const run = step(name).match(/^        run: ([^\n]+)\n((?: {10}[^\n]*\n)*)/m);
  if (!run) throw new Error(`Missing run script for ${name}`);
  return run[1] === "|" ? run[2] : run[1];
}

function probeCommand(name: string, path: string): string {
  const command = runScript(name);
  expect(command.match(/https?:\/\/[^\s"'\\]+/g)).toEqual([
    `https://friendsofanimals.dev${path}`,
  ]);
  return command;
}

function bashExitCode(command: string): Promise<number> {
  return new Promise((resolve, reject) => {
    execFile(
      "bash",
      ["-eo", "pipefail", "-c", command],
      {
        env: { PATH: process.env.PATH, NODE_ENV: "test", NO_PROXY: "*" },
        timeout: 4000,
      },
      (error) => {
        if (!error) {
          resolve(0);
        } else if (typeof error.code === "number") {
          resolve(error.code);
        } else {
          reject(error);
        }
      }
    );
  });
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
    for (const { name, path } of HTTP_PROBES) {
      expect(probeCommand(name, path)).toContain(
        "curl --disable -fsS --max-time 20 --retry 1 --retry-delay 30"
      );
    }
    expect(config).toContain("nc -z -w5 db.friendsofanimals.dev 6432");
    expect(config).not.toMatch(/\bcontinue-on-error:/);
  });

  it("runs every check even when an earlier one fails", () => {
    expect(steps().map((block) => block.split("\n")[0])).toEqual([
      HTTP_PROBES[0].name,
      DATABASE_PROBE,
      HTTP_PROBES[1].name,
    ]);
    for (const block of steps()) {
      expect(block).toMatch(/^        if: \$\{\{ !cancelled\(\) \}\}$/m);
    }
  });
});

describe(DATABASE_PROBE, () => {
  async function closedPort(): Promise<number> {
    const probe = createTcpServer().listen(0, "127.0.0.1");
    await once(probe, "listening");
    const address = probe.address();
    if (!address || typeof address === "string") {
      throw new Error("Missing loopback port");
    }
    await new Promise<void>((resolve) => probe.close(() => resolve()));
    return address.port;
  }

  it.each([
    { outcome: "an open listener", opensAfterMs: 0, exitCode: 0, tries: 1 },
    {
      outcome: "a listener that opens before the retry",
      opensAfterMs: 300,
      exitCode: 0,
      tries: 1,
    },
    { outcome: "a closed port", opensAfterMs: null, exitCode: 1, tries: 0 },
  ])(
    "exits $exitCode for $outcome",
    async ({ opensAfterMs, exitCode, tries }) => {
      const port = await closedPort();
      let connections = 0;
      const listener = createTcpServer((socket) => {
        connections += 1;
        socket.destroy();
      });
      const opening =
        opensAfterMs === null
          ? Promise.resolve()
          : new Promise<void>((resolve) => {
              setTimeout(() => {
                listener.listen(port, "127.0.0.1", () => resolve());
              }, opensAfterMs);
            });
      const command = runScript(DATABASE_PROBE)
        .replaceAll("db.friendsofanimals.dev 6432", `127.0.0.1 ${port}`)
        // Exercise the retry without a 30-second wait.
        .replace("sleep 30", "sleep 1");
      expect(command).not.toContain("friendsofanimals.dev");

      try {
        if (opensAfterMs === 0) await opening;
        const [code] = await Promise.all([bashExitCode(command), opening]);
        expect(code).toBe(exitCode);
        expect(connections).toBe(tries);
      } finally {
        if (listener.listening) {
          await new Promise<void>((resolve) => listener.close(() => resolve()));
        }
      }
    }
  );
});

describe.each(HTTP_PROBES)("$name", ({ name, path }) => {
  it.each([
    { outcome: "HTTP 200", responses: [200], exitCode: 0 },
    { outcome: "HTTP 204", responses: [204], exitCode: 1 },
    { outcome: "a redirect to HTTP 200", responses: [302], exitCode: 1 },
    { outcome: "HTTP 404", responses: [404], exitCode: 22 },
    { outcome: "two HTTP 503 responses", responses: [503, 503], exitCode: 22 },
    { outcome: "HTTP 503 then 200", responses: [503, 200], exitCode: 0 },
    {
      outcome: "a truncated HTTP 200",
      responses: ["truncated" as const],
      exitCode: 18,
    },
  ])("exits $exitCode for $outcome", async ({ responses, exitCode }) => {
    const requests: string[] = [];
    const server = createServer((request, response) => {
      const status = responses[requests.length] ?? 200;
      requests.push(request.url ?? "");
      if (status === "truncated") {
        response
          .writeHead(200, { "Content-Length": 100, Connection: "close" })
          .end("incomplete");
        return;
      }
      if (status === 302) response.setHeader("Location", "/redirect-target");
      response.writeHead(status).end();
    }).listen(0, "127.0.0.1");

    try {
      await once(server, "listening");
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Missing loopback server address");
      }
      const command = probeCommand(name, path)
        .replace(
          "https://friendsofanimals.dev",
          `http://127.0.0.1:${address.port}`
        )
        // Exercise curl's retry without a 30-second wait.
        .replace("--retry-delay 30", "--retry-delay 1");

      expect(await bashExitCode(command)).toBe(exitCode);
      expect(requests).toEqual(responses.map(() => path));
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
