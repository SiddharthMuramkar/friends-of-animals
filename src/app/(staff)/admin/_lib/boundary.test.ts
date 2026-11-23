import { inspect } from "node:util";
import { describe, expect, it } from "vitest";

import { APP_ROUTES } from "@/lib/app-routes";
import { createHarness } from "@/test/harness";

import { adminCall } from "./boundary";

/** What Next's logger would print for a thrown error. */
async function failureOf(call: Promise<unknown>): Promise<string> {
  const failure: unknown = await call.then(
    () => null,
    (error: unknown) => error
  );
  expect(failure instanceof Error && !("cause" in failure)).toBe(true);
  return inspect(failure, { depth: 10, showHidden: true });
}

describe("the admin boundary", () => {
  it("keeps the search text and the driver cause out of a failed search", async () => {
    const h = await createHarness();
    const admin = await h.signIn(await h.seed.superAdmin());
    const query = "kavya.menon@example.test";
    await h.db.$client.exec(`ALTER TABLE "user" RENAME COLUMN "name" TO "x"`);

    const logged = await failureOf(
      adminCall(() => h.as(admin).searchUsers({ query }), APP_ROUTES.adminRoles)
    );

    expect(logged.includes("kavya")).toBe(false);
    expect(logged.includes("params:")).toBe(false);
    expect(logged.includes("42703")).toBe(true);
  });

  it("keeps the change's details out of a failed audit entry", async () => {
    const h = await createHarness();
    const admin = await h.signIn(await h.seed.superAdmin());
    const member = await h.seed.member();
    await h.db.$client.exec(`
      ALTER TABLE "audit_log" ADD CONSTRAINT "test_refuse_grants"
      CHECK (action <> 'role.granted')
    `);

    const logged = await failureOf(
      adminCall(
        () =>
          h.as(admin).grantRole({
            userId: member.id,
            role: "judge",
            scope: { type: "global" },
          }),
        APP_ROUTES.adminRoles
      )
    );

    expect(logged.includes(member.id)).toBe(false);
    expect(logged.includes("params:")).toBe(false);
    expect(logged.includes("test_refuse_grants")).toBe(false);
    expect(logged.includes("23514")).toBe(true);
  });

  it("turns a policy refusal into a result, for the page to explain", async () => {
    const h = await createHarness();
    const member = await h.signIn(await h.seed.member());

    expect(
      await adminCall(
        () => h.as(member).searchUsers({ query: "asha" }),
        APP_ROUTES.adminRoles
      )
    ).toEqual({ ok: false });
  });

  it("returns what the use case returned", async () => {
    const h = await createHarness();
    const admin = await h.signIn(await h.seed.superAdmin());

    expect(
      await adminCall(
        () => h.as(admin).searchUsers({ query: "" }),
        APP_ROUTES.adminRoles
      )
    ).toMatchObject({ ok: true, value: { ok: false, error: "invalid_input" } });
  });

  it("sends staff who haven't passed their second factor to pass it", async () => {
    const h = await createHarness();
    const admin = await h.seed.superAdmin();
    await h.seed.authenticator({ id: admin.id });
    const actor = await h.signIn(admin, undefined, { secondFactor: false });

    await expect(
      adminCall(
        () => h.as(actor).searchUsers({ query: "asha" }),
        APP_ROUTES.adminRoles
      )
    ).rejects.toMatchObject({
      message: "NEXT_REDIRECT",
      digest: expect.stringContaining(
        "/auth/second-factor?next=%2Fadmin%2Froles"
      ),
    });
  });
});
