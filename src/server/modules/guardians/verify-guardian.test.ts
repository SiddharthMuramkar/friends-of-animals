import { describe, expect, it } from "vitest";

import { createGuardiansHarness } from "./testing";

const SUNITA = { name: "Sunita Rao", email: "sunita@example.test" };

describe("registerAsGuardian", () => {
  it("records a member's declaration as an unverified guardian", async () => {
    const h = await createGuardiansHarness();
    const member = await h.seed.member(SUNITA);
    const actor = await h.signIn(member);

    const result = await h.as(actor).registerAsGuardian({
      fullName: "Sunita Rao",
      phone: "98765 43210",
      adultDeclared: true,
    });

    expect(result).toEqual({ ok: true });
    expect(await h.as(actor).myGuardianProfile()).toEqual({
      registered: true,
      fullName: "Sunita Rao",
      phone: "+919876543210",
      verified: false,
      verifiedAt: null,
    });
  });
});
