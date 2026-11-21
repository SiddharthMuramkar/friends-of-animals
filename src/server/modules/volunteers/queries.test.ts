import { describe, expect, it } from "vitest";

import { createHarness } from "@/test/harness";

describe("myVolunteerApplication", () => {
  it("is null for a member who has never applied", async () => {
    const h = await createHarness();
    const member = await h.signIn(await h.seed.member());

    expect(await h.as(member).myVolunteerApplication()).toBeNull();
  });
});
