import { describe, expect, it } from "vitest";

import { refusedFormState } from "./form-state";

describe("refusedFormState", () => {
  it("keeps what was typed beside why the save was refused", () => {
    const typed = {
      subject: "Welcome aboard",
      body: "Hello {{recipient.name}}, welcome.",
      dltTemplateId: "",
    };
    const why =
      "Enter a code from your authenticator app for this session first, then save again.";

    expect(refusedFormState({ version: 3 }, typed, why)).toEqual({
      status: "refused",
      version: 3,
      fieldErrors: {},
      values: typed,
      message: why,
    });
  });
});
