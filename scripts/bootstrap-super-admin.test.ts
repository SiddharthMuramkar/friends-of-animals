// Runs the real `pnpm admin:bootstrap-super-admin`, as an operator would,
// against a stand-in database server on this machine that refuses the
// login. The operator must read which database the script writes to before
// it connects, and a failure line that shows neither the URL's credentials
// nor its query, nor what the server said about them.

import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, onTestFinished } from "vitest";

const SCRIPT = fileURLToPath(
  new URL("./bootstrap-super-admin.ts", import.meta.url)
);
/** tsx's command line, which `pnpm admin:bootstrap-super-admin` runs. */
const TSX = createRequire(import.meta.url).resolve("tsx/cli");

const USER = "bootstrap_op";
const PASSWORD = "pw-not-printed";
const QUERY_VALUE = "param-not-printed";

describe("pnpm admin:bootstrap-super-admin", () => {
  it("names its target before it connects, and fails without credentials or the URL's query", async () => {
    let stdout = "";
    let stderr = "";
    const targetPrinted = Promise.withResolvers<void>();

    // Refuses every login with a FATAL error that quotes the user and the
    // application, as a server's own messages can. It answers only once the
    // script has printed its target: a script that connected before
    // printing it would wait here for ever, and the test fails on its
    // timeout.
    const server = createServer((socket) => {
      socket.once("data", () => {
        void targetPrinted.promise.then(() =>
          socket.end(
            errorResponse({
              S: "FATAL",
              V: "FATAL",
              C: "28P01",
              M: `password authentication failed for user "${USER}" (application "${QUERY_VALUE}")`,
            })
          )
        );
      });
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    onTestFinished(() => {
      server.close();
    });
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("The stand-in server has no TCP port.");
    }

    // An empty working directory, so no .env file fills anything in.
    const cwd = await mkdtemp(join(tmpdir(), "foa-bootstrap-"));
    onTestFinished(() => rm(cwd, { recursive: true, force: true }));
    const script = spawn(
      process.execPath,
      [TSX, SCRIPT, "--email", "owner@example.test"],
      {
        cwd,
        env: {
          // Next's types require it; the script doesn't read it.
          NODE_ENV: process.env.NODE_ENV,
          DIRECT_URL: `postgres://${USER}:${PASSWORD}@127.0.0.1:${address.port}/foa?application_name=${QUERY_VALUE}`,
        },
      }
    );
    onTestFinished(() => {
      script.kill();
    });
    script.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      stdout += chunk;
      if (stdout.includes("Target:")) targetPrinted.resolve();
    });
    script.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      stderr += chunk;
    });
    const [code] = await once(script, "close");

    expect(stdout).toBe("Target: 127.0.0.1/foa\n");
    // The error's class and Postgres code, and nothing the server said.
    expect(stderr).toMatch(/^Bootstrap failed: \w+ \(Postgres 28P01\)\n$/);
    expect(code).toBe(1);
    for (const secret of [USER, PASSWORD, QUERY_VALUE]) {
      expect(stdout + stderr).not.toContain(secret);
    }
  });
});

/** A Postgres ErrorResponse message with these fields (protocol 3.0). */
function errorResponse(fields: Record<string, string>): Buffer {
  const body = Buffer.from(
    Object.entries(fields)
      .map(([type, value]) => `${type}${value}\0`)
      .join("") + "\0"
  );
  const header = Buffer.alloc(5);
  header.write("E");
  header.writeInt32BE(body.length + 4, 1);
  return Buffer.concat([header, body]);
}
