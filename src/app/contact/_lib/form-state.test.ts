import { describe, expect, it } from "vitest";

import {
  afterFailure,
  afterSubmit,
  EMPTY,
  enteredFrom,
  keepsProof,
  type ContactFormEntered,
} from "./form-state";

const entered: ContactFormEntered = {
  topic: "SCHOOLS",
  name: "Asha Rao",
  email: "asha@example.test",
  organisation: "",
  subject: "A competition at our school",
  message: "Classes 6 to 8.",
};

describe("afterSubmit", () => {
  it("shows the reference once the message is sent, and keeps nothing typed", () => {
    expect(
      afterSubmit({ ok: true, reference: "CM-27-8H3TZ0" }, entered)
    ).toEqual({ step: "sent", reference: "CM-27-8H3TZ0", entered: EMPTY });
  });

  it("keeps what was typed and marks the fields to fix", () => {
    expect(
      afterSubmit(
        { ok: false, error: "invalid_input", fields: ["email", "message"] },
        entered
      )
    ).toEqual({
      step: "form",
      entered,
      fieldErrors: { email: true, message: true },
    });
  });

  it("asks to send again when the human check failed", () => {
    expect(
      afterSubmit({ ok: false, error: "human_check_failed" }, entered)
    ).toEqual({ step: "form", entered, alert: "human_check_failed" });
  });

  it("says how many minutes to wait when rate limited, rounded up", () => {
    expect(
      afterSubmit(
        {
          ok: false,
          error: "rate_limited",
          retryAfter: new Date("2027-01-15T05:00:00Z"),
          retryAfterSeconds: 61,
        },
        entered
      )
    ).toEqual({
      step: "form",
      entered,
      alert: "rate_limited",
      retryAfterMinutes: 2,
    });
  });
});

describe("afterFailure", () => {
  it("keeps what was typed and says something went wrong", () => {
    expect(afterFailure(entered)).toEqual({
      step: "form",
      entered,
      alert: "failed",
    });
  });
});

describe("enteredFrom", () => {
  it("reads the form's fields, and blanks for anything missing or a file", () => {
    const form = new FormData();
    form.set("topic", "MEDIA");
    form.set("name", "Ravi");
    form.set("message", new Blob(["x"]));

    expect(enteredFrom(form)).toEqual({
      ...EMPTY,
      topic: "MEDIA",
      name: "Ravi",
    });
  });
});

describe("keepsProof", () => {
  it("keeps the proof a refused send left unspent, so its 3 seconds run on", () => {
    expect(
      keepsProof(
        afterSubmit(
          { ok: false, error: "invalid_input", fields: ["message"] },
          entered
        )
      )
    ).toBe(true);
    expect(
      keepsProof(
        afterSubmit(
          {
            ok: false,
            error: "rate_limited",
            retryAfter: new Date("2027-01-15T05:30:00Z"),
            retryAfterSeconds: 3600,
          },
          entered
        )
      )
    ).toBe(true);
  });

  it("drops one that was spent, refused itself, or may have been", () => {
    expect(
      keepsProof(afterSubmit({ ok: true, reference: "CM-27-8H3TZ0" }, entered))
    ).toBe(false);
    expect(
      keepsProof(
        afterSubmit({ ok: false, error: "human_check_failed" }, entered)
      )
    ).toBe(false);
    expect(keepsProof(afterFailure(entered))).toBe(false);
  });
});
