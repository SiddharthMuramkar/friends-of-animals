import { describe, expect, it } from "vitest";

import { DomainError } from "@/server/errors";

import { unlessRefused } from "./refusal";

describe("unlessRefused", () => {
  it("hands back what the use case returned", async () => {
    expect(await unlessRefused(async () => ["identity.welcome"])).toEqual({
      ok: true,
      value: ["identity.welcome"],
    });
  });

  it.each([
    "forbidden",
    "enrolment_required",
    "second_factor_required",
    "step_up_required",
  ] as const)("says why the use case refused: %s", async (code) => {
    expect(
      await unlessRefused(async () => {
        throw new DomainError(code, "refused");
      })
    ).toEqual({ ok: false, refusal: code });
  });

  it("lets any other error through", async () => {
    const failure = new Error("select … from message_template");
    await expect(
      unlessRefused(async () => {
        throw failure;
      })
    ).rejects.toBe(failure);
  });
});
