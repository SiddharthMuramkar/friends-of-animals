import { describe, expect, it } from "vitest";

import {
  afterFailure,
  afterRequest,
  afterVerify,
  START,
  waitFor,
} from "./code-form-state";

const asha = { contact: "asha@example.test", name: "Asha Rao" };
const ashaByPhone = { contact: "98765 43210", name: "Asha Rao" };

describe("afterRequest", () => {
  it("moves on to the code once it is sent", () => {
    expect(afterRequest("email", { ok: true }, asha)).toEqual({
      step: "code",
      ...asha,
      sent: true,
    });
    expect(afterRequest("phone", { ok: true }, ashaByPhone)).toEqual({
      step: "code",
      ...ashaByPhone,
      sent: true,
    });
  });

  it("stays on the email step and marks the fields that were wrong", () => {
    expect(
      afterRequest(
        "email",
        { ok: false, error: "invalid_input", fields: ["email"] },
        asha
      )
    ).toEqual({ step: "contact", ...asha, fieldErrors: { contact: true } });
  });

  it("stays on the phone step and marks the fields that were wrong", () => {
    expect(
      afterRequest(
        "phone",
        { ok: false, error: "invalid_input", fields: ["phone", "name"] },
        ashaByPhone
      )
    ).toEqual({
      step: "contact",
      ...ashaByPhone,
      fieldErrors: { contact: true, name: true },
    });
  });

  it("says how many minutes to wait when rate limited, rounded up", () => {
    expect(
      afterRequest(
        "email",
        { ok: false, error: "rate_limited", retryAfterSeconds: 61 },
        asha
      )
    ).toEqual({
      step: "contact",
      ...asha,
      alert: "rate_limited",
      retryAfterMinutes: 2,
    });
  });

  it.each(["unsupported_country", "sms_disabled"] as const)(
    "points %s to email from the phone step",
    (error) => {
      expect(
        afterRequest("phone", { ok: false, error }, ashaByPhone, "code")
      ).toEqual({ step: "contact", ...ashaByPhone, alert: error });
    }
  );
});

describe("afterRequest, for a new code asked for on the code step", () => {
  it("stays on the code step when it is refused: the last code still works", () => {
    expect(
      afterRequest(
        "email",
        { ok: false, error: "rate_limited", retryAfterSeconds: 600 },
        asha,
        "code"
      )
    ).toEqual({
      step: "code",
      ...asha,
      alert: "rate_limited",
      retryAfterMinutes: 10,
    });
    expect(
      afterRequest(
        "phone",
        { ok: false, error: "rate_limited", retryAfterSeconds: 61 },
        ashaByPhone,
        "code"
      )
    ).toEqual({
      step: "code",
      ...ashaByPhone,
      alert: "rate_limited",
      retryAfterMinutes: 2,
    });
  });

  it("moves on to the code, as from the first step, once it is sent", () => {
    expect(afterRequest("email", { ok: true }, asha, "code")).toEqual({
      step: "code",
      ...asha,
      sent: true,
    });
  });
});

describe("afterFailure", () => {
  it("stays on the step the form was showing", () => {
    expect(afterFailure("code", asha)).toEqual({
      step: "code",
      ...asha,
      alert: "failed",
    });
    expect(afterFailure("contact", asha)).toEqual({
      step: "contact",
      ...asha,
      alert: "failed",
    });
  });
});

describe("afterVerify", () => {
  const onCode = { step: "code" as const, ...asha, sent: true };
  const onPhoneCode = { step: "code" as const, ...ashaByPhone, sent: true };

  it("marks a wrong code on the code field", () => {
    expect(
      afterVerify("email", { ok: false, error: "code_invalid" }, onCode)
    ).toEqual({ step: "code", ...asha, fieldErrors: { code: true } });
    expect(
      afterVerify("phone", { ok: false, error: "code_invalid" }, onPhoneCode)
    ).toEqual({ step: "code", ...ashaByPhone, fieldErrors: { code: true } });
  });

  it.each(["code_expired", "too_many_attempts", "no_account"] as const)(
    "explains %s for the whole form",
    (error) => {
      expect(afterVerify("email", { ok: false, error }, onCode)).toEqual({
        step: "code",
        ...asha,
        alert: error,
      });
      expect(afterVerify("phone", { ok: false, error }, onPhoneCode)).toEqual({
        step: "code",
        ...ashaByPhone,
        alert: error,
      });
    }
  );

  it("marks a missing name or a malformed code", () => {
    expect(
      afterVerify(
        "email",
        { ok: false, error: "invalid_input", fields: ["name", "code"] },
        onCode
      )
    ).toEqual({
      step: "code",
      ...asha,
      fieldErrors: { name: true, code: true },
    });
  });

  it("goes back to the phone step when SMS was switched off meanwhile", () => {
    expect(
      afterVerify("phone", { ok: false, error: "sms_disabled" }, onPhoneCode)
    ).toEqual({ step: "contact", ...ashaByPhone, alert: "sms_disabled" });
  });
});

describe("waitFor", () => {
  it("counts a wait of an hour or less in minutes", () => {
    expect(waitFor(2)).toEqual({ minutes: 2 });
    expect(waitFor(60)).toEqual({ minutes: 60 });
  });

  it("counts a longer wait (the day's limit) in hours, rounded up", () => {
    expect(waitFor(61)).toEqual({ hours: 2 });
    expect(waitFor(600)).toEqual({ hours: 10 });
  });

  it("says 15 minutes, one window, when the wait is unknown", () => {
    expect(waitFor(undefined)).toEqual({ minutes: 15 });
  });
});

describe("START", () => {
  it("asks for the email address or phone number first", () => {
    expect(START).toEqual({ step: "contact", contact: "", name: "" });
  });
});
