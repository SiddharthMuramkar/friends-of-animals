import { expect, it } from "vitest";

import { saveAnswersAction, sendCodeAction, verifyCodeAction } from "./actions";

const fixture = "z".repeat(43);

it("returns form errors for invalid form envelopes before accessing the request", async () => {
  const invalidForm = {};
  await expect
    .soft(verifyCodeAction(fixture, null, invalidForm))
    .resolves.toEqual({
      ok: false,
      error: "invalid_code",
    });
  await expect
    .soft(saveAnswersAction(fixture, null, invalidForm))
    .resolves.toEqual({
      ok: false,
      error: "invalid_answer",
    });
});

it("returns the generic link error for invalid bound tokens at every action", async () => {
  const form = new FormData();
  const notFound = { ok: false, error: "not_found" };
  await expect.soft(sendCodeAction("invalid")).resolves.toEqual(notFound);
  await expect
    .soft(verifyCodeAction("invalid", null, form))
    .resolves.toEqual(notFound);
  await expect
    .soft(saveAnswersAction("invalid", null, form))
    .resolves.toEqual(notFound);
});
