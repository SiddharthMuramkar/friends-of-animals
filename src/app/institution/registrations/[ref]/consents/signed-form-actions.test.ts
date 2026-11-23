import { expect, it } from "vitest";

import { signedFormCommandAction } from "./signed-form-actions";

it.each([
  null,
  { kind: "dismiss" },
  { kind: "declare", registrationId: "invalid" },
  { kind: "withdraw", formId: "invalid" },
])("validates a signed-form command before dispatch (%j)", async (command) => {
  await expect(
    signedFormCommandAction(
      command as Parameters<typeof signedFormCommandAction>[0],
      {}
    )
  ).resolves.toEqual({ error: "invalid_input" });
});
