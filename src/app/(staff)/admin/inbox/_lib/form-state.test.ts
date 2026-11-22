import { describe, expect, it } from "vitest";

import { inboxFormState, secondStepRedirect } from "./form-state";

const TEXTS = {
  saved: "Saved.",
  unchanged: "Nothing changed.",
  refused: {
    message_closed: "Reopen the message to assign it.",
    not_found: "This message is gone.",
  },
};

describe("inboxFormState", () => {
  it("says it saved a change, or a new note, and gives nothing back", () => {
    expect(inboxFormState({ ok: true, changed: true }, TEXTS, "typed")).toEqual(
      { status: "saved", message: "Saved.", typed: "" }
    );
    expect(inboxFormState({ ok: true }, TEXTS, "typed")).toEqual({
      status: "saved",
      message: "Saved.",
      typed: "",
    });
  });

  it("says when nothing changed", () => {
    expect(inboxFormState({ ok: true, changed: false }, TEXTS)).toEqual({
      status: "unchanged",
      message: "Nothing changed.",
      typed: "",
    });
  });

  it("explains a refusal in words and keeps what was typed", () => {
    expect(
      inboxFormState(
        { ok: false, error: "message_closed" },
        TEXTS,
        "Call back on Monday"
      )
    ).toEqual({
      status: "refused",
      message: "Reopen the message to assign it.",
      typed: "Call back on Monday",
    });
  });
});

describe("secondStepRedirect", () => {
  const ID = "01938a00-0000-7000-8113-000000000001";

  it("sends staff short of their second step to lift it, then back", () => {
    expect(secondStepRedirect("second_factor_required", ID)).toBe(
      `/auth/second-factor?next=%2Fadmin%2Finbox%2F${ID}`
    );
    expect(secondStepRedirect("step_up_required", ID)).toBe(
      `/auth/step-up?next=%2Fadmin%2Finbox%2F${ID}`
    );
    expect(secondStepRedirect("enrolment_required")).toBe(
      "/account/security?next=%2Fadmin%2Finbox"
    );
  });

  it("leaves a refusal no second step can lift to the page", () => {
    expect(secondStepRedirect("forbidden", ID)).toBeNull();
  });
});
