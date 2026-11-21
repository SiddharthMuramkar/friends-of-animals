import { spawn } from "node:child_process";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const SCRIPT = fileURLToPath(
  new URL("./umami-admin-password.mjs", import.meta.url)
);
const SEEDED = "umami";
const NEW_PASSWORD = "b".repeat(64);

type Received = {
  path: string;
  body: Record<string, unknown>;
  authorization: string | undefined;
};

/**
 * Just enough of Umami 3.5's API for the script: one admin user, the login
 * route and the change-password route. Records every request.
 */
async function fakeUmami(
  options: { password?: string; failWith?: number; ignoreChange?: boolean } = {}
) {
  let password = options.password ?? SEEDED;
  const sessions = new Set<string>();
  const received: Received[] = [];
  const server = createServer((request, response) => {
    let raw = "";
    request.on("data", (chunk: Buffer) => {
      raw += chunk.toString();
    });
    request.on("end", () => {
      const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      received.push({
        path: request.url ?? "",
        body,
        authorization: request.headers.authorization,
      });
      const reply = (status: number, json: unknown) => {
        response.writeHead(status, { "content-type": "application/json" });
        response.end(JSON.stringify(json));
      };
      if (options.failWith !== undefined) {
        reply(options.failWith, {});
      } else if (request.url === "/api/auth/login") {
        if (body.username !== "admin" || body.password !== password) {
          reply(401, { code: "incorrect-username-password" });
          return;
        }
        const token = `session-${sessions.size + 1}`;
        sessions.add(token);
        reply(200, { token, user: { username: "admin", isAdmin: true } });
      } else if (request.url === "/api/me/password") {
        const token = request.headers.authorization?.replace(/^Bearer /, "");
        if (token === undefined || !sessions.has(token)) {
          reply(401, {});
        } else if (body.currentPassword !== password) {
          reply(400, { message: "Current password is incorrect" });
        } else {
          if (!options.ignoreChange) password = String(body.newPassword);
          sessions.clear();
          reply(200, { username: "admin", token: "session-new" });
        }
      } else {
        reply(404, {});
      }
    });
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    received,
    password: () => password,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}

/** Runs the script against `url`, with `stdin` as its input. */
function run(url: string, stdin: string) {
  return new Promise<{ status: number | null; stdout: string; stderr: string }>(
    (resolve, reject) => {
      const child = spawn(process.execPath, [SCRIPT], {
        env: { ...process.env, FOA_UMAMI_URL: url },
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      child.on("error", reject);
      child.on("close", (status) => resolve({ status, stdout, stderr }));
      child.stdin.end(stdin);
    }
  );
}

let umami: Awaited<ReturnType<typeof fakeUmami>> | undefined;

afterEach(async () => {
  await umami?.close();
  umami = undefined;
});

describe("umami-admin-password.mjs", () => {
  it("replaces the seeded admin login with the password on stdin", async () => {
    umami = await fakeUmami();

    const result = await run(umami.url, `${NEW_PASSWORD}\n`);

    expect(result).toMatchObject({
      status: 0,
      stdout: "replaced the seeded admin login\n",
    });
    expect(umami.password()).toBe(NEW_PASSWORD);
    expect(umami.received.map((request) => request.path)).toEqual([
      "/api/auth/login",
      "/api/me/password",
      // Checks the seeded login no longer works.
      "/api/auth/login",
    ]);
    expect(umami.received[1]).toMatchObject({
      authorization: "Bearer session-1",
      body: { currentPassword: SEEDED, newPassword: NEW_PASSWORD },
    });
    expect(result.stdout + result.stderr).not.toContain(NEW_PASSWORD);
  });

  it("changes nothing once the seeded login is gone", async () => {
    umami = await fakeUmami({ password: NEW_PASSWORD });

    const result = await run(umami.url, `${NEW_PASSWORD}\n`);

    expect(result).toMatchObject({
      status: 0,
      stdout: "kept the admin password\n",
    });
    expect(umami.received.map((request) => request.path)).toEqual([
      "/api/auth/login",
      "/api/auth/login",
    ]);
  });

  it("says so when the stored password doesn't sign in either", async () => {
    umami = await fakeUmami({ password: "c".repeat(64) });

    const result = await run(umami.url, `${NEW_PASSWORD}\n`);

    // The seeded login is gone, which is what matters here.
    expect(result.status).toBe(0);
    expect(result.stderr).toMatch(/doesn't sign in/);
    expect(umami.password()).toBe("c".repeat(64));
  });

  it("fails while the seeded login still works", async () => {
    umami = await fakeUmami({ ignoreChange: true });

    const result = await run(umami.url, `${NEW_PASSWORD}\n`);

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/seeded admin login still works/);
  });

  it("fails when Umami answers with an error", async () => {
    umami = await fakeUmami({ failWith: 500 });

    const result = await run(umami.url, `${NEW_PASSWORD}\n`);

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/HTTP 500/);
  });

  it("fails when Umami can't be reached", async () => {
    const closed = await fakeUmami();
    await closed.close();

    const result = await run(closed.url, `${NEW_PASSWORD}\n`);

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/can't reach Umami/);
  });

  it.each(["", SEEDED, "B".repeat(64), `${"b".repeat(63)}'`])(
    "refuses the new password %j without asking Umami anything",
    async (password) => {
      umami = await fakeUmami();

      const result = await run(umami.url, `${password}\n`);

      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/64 hex/);
      expect(umami.received).toEqual([]);
    }
  );
});
