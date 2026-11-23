import { describe, expect, it } from "vitest";

import { createHarness } from "@/test/harness";

describe("getAccount", () => {
  it("shows a signed-in user their own account", async () => {
    const h = await createHarness();
    const member = await h.seed.member({
      name: "Asha Rao",
      email: "asha@example.test",
    });
    const asha = await h.signIn(member);

    expect(await h.as(asha).getAccount()).toEqual({
      name: "Asha Rao",
      email: "asha@example.test",
      phone: null,
    });
  });

  it("is not for visitors", async () => {
    const h = await createHarness();
    await expect(h.as(h.visitor()).getAccount()).rejects.toMatchObject({
      code: "forbidden",
    });
  });
});
