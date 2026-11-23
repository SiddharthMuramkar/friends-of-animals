import { expect, it } from "vitest";

import { signedFormCommandAction } from "./signed-form-actions";

const scope = {
  institutionId: "01938a00-0000-7000-8000-000000000001",
  registrationId: "01938a00-0000-7000-8000-000000000002",
};

it.each([
  null,
  { kind: "dismiss", ...scope },
  { kind: "declare", ...scope, registrationId: "invalid" },
  { kind: "withdraw", ...scope, formId: "invalid" },
  { kind: "declare", registrationId: scope.registrationId },
])("validates a signed-form command before dispatch (%j)", async (command) => {
  await expect(
    signedFormCommandAction(
      command as Parameters<typeof signedFormCommandAction>[0],
      {}
    )
  ).resolves.toEqual({ error: "invalid_input" });
});
