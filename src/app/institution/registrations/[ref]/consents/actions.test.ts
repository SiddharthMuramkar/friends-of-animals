import { expect, it } from "vitest";

import {
  revokeLinkAction,
  sendLinkAction,
  suggestContactAction,
} from "./actions";

const fixtureId = "00000000-0000-4000-8000-000000000001";

it("rejects invalid coordinator action arguments before using the request", async () => {
  const invalid = {
    ok: false,
    error: "invalid_input",
    message: "Enter a valid address for the selected delivery method.",
  };
  const form = new FormData();
  form.set("channel", "email");
  form.set("address", "guardian@example.test");
  await expect
    .soft(sendLinkAction(fixtureId, fixtureId, fixtureId, null, {}))
    .resolves.toMatchObject(invalid);
  await expect
    .soft(sendLinkAction(fixtureId, fixtureId, "invalid", null, form))
    .resolves.toMatchObject(invalid);
  await expect
    .soft(revokeLinkAction(fixtureId, fixtureId, "invalid"))
    .resolves.toMatchObject(invalid);
  await expect
    .soft(suggestContactAction(fixtureId, fixtureId, "invalid"))
    .resolves.toBeNull();
});
