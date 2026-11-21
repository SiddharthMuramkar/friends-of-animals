import { describe, expect, it } from "vitest";

import { outbox } from "@/server/db/schema";
import { emit } from "@/server/outbox";
import { createHarness, type Harness } from "@/test/harness";

import { drainRequest, type DrainRequest } from "./drain-request";

const TOKEN = "preview-mailbox-token-0123456789";

const PREVIEW: DrainRequest = {
  appEnv: "preview",
  configuredToken: TOKEN,
  providedToken: TOKEN,
};

/** A member whose welcome delivery is due. */
async function newMember(h: Harness) {
  const member = await h.seed.member({ name: "Asha Rao" });
  await h.db.transaction((tx) =>
    emit(tx, h.clock, {
      type: "identity.user_signed_up",
      aggregate: { type: "user", id: member.id },
      payload: { userId: member.id },
    })
  );
  return member;
}

async function statuses(h: Harness) {
  const rows = await h.db.select({ status: outbox.status }).from(outbox);
  return rows.map((row) => row.status);
}

describe("POST /api/preview/drain", () => {
  it("drains a preview's outbox for the token holder and reports what it did", async () => {
    const h = await createHarness();
    const member = await newMember(h);

    const response = await drainRequest(h.deps, PREVIEW);

    expect(response).toEqual({
      status: 200,
      body: { dispatched: 1, retried: 0, failed: 0, skipped: 0 },
    });
    expect(h.email.lastTo(member.email)?.subject).toBe(
      "Welcome to Friends of Animals"
    );
  });

  it("drains a local run's outbox too", async () => {
    const h = await createHarness();
    await newMember(h);

    const response = await drainRequest(h.deps, {
      ...PREVIEW,
      appEnv: "local",
    });

    expect(response.status).toBe(200);
    expect(await statuses(h)).toEqual(["dispatched"]);
  });

  it.each(["staging", "production"] as const)(
    "is absent on %s, which have a worker, even with the token",
    async (appEnv) => {
      const h = await createHarness();
      await newMember(h);

      expect(await drainRequest(h.deps, { ...PREVIEW, appEnv })).toEqual({
        status: 404,
      });
      expect(await statuses(h)).toEqual(["pending"]);
    }
  );

  it("is absent while no mailbox token is configured", async () => {
    const h = await createHarness();
    await newMember(h);

    const response = await drainRequest(h.deps, {
      ...PREVIEW,
      configuredToken: undefined,
    });

    expect(response).toEqual({ status: 404 });
    expect(await statuses(h)).toEqual(["pending"]);
  });

  it.each([
    ["no token", null],
    ["an empty token", ""],
    ["a wrong token", `${TOKEN}x`],
    ["a token of another length", TOKEN.slice(1)],
  ])("refuses %s", async (_, providedToken) => {
    const h = await createHarness();
    await newMember(h);

    const response = await drainRequest(h.deps, { ...PREVIEW, providedToken });

    expect(response).toEqual({ status: 401 });
    expect(await statuses(h)).toEqual(["pending"]);
    expect(h.email.sent).toEqual([]);
  });
});
