import { inspect } from "node:util";
import { describe, expect, it } from "vitest";

import { APP_ROUTES } from "@/lib/app-routes";
import { createHarness } from "@/test/harness";

import { orSecondFactor } from "./refusal";

describe("the second-factor boundary", () => {
  it("keeps database query values and the driver cause out of an action failure", async () => {
    const h = await createHarness();
    const actor = await h.signIn(await h.seed.member());
    const label = "Test authenticator label";
    await h.db.$client.exec(`
      ALTER TABLE "second_factor" ADD CONSTRAINT "test_refuse_totp"
      CHECK (kind <> 'totp')
    `);

    const failure: unknown = await orSecondFactor(
      () => h.as(actor).startTotpEnrolment({ label }),
      APP_ROUTES.accountSecurity
    ).then(
      () => null,
      (error: unknown) => error
    );

    const logged = inspect(failure, { depth: 10, showHidden: true });
    expect(logged.includes(label)).toBe(false);
    expect(logged.includes("params:")).toBe(false);
    expect(logged.includes("test_refuse_totp")).toBe(false);
    expect(failure instanceof Error && !("cause" in failure)).toBe(true);
    expect(logged.includes("Second-factor operation failed")).toBe(true);
    expect(logged.includes("23514")).toBe(true);
  });

  it("preserves the step-up redirect and return path", async () => {
    const h = await createHarness();
    const actor = await h.signIn(await h.seed.member());
    await h.passSecondFactor(actor);
    h.clock.advance({ minutes: 11 });

    await expect(
      orSecondFactor(
        () => h.as(actor).startTotpEnrolment({ label: "Replacement" }),
        APP_ROUTES.accountSecurity
      )
    ).rejects.toMatchObject({
      message: "NEXT_REDIRECT",
      digest: expect.stringContaining(
        "/auth/step-up?next=%2Faccount%2Fsecurity"
      ),
    });
  });
});
