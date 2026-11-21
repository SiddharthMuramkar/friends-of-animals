import { describe, expect, it } from "vitest";

import {
  afterPhoneFailure,
  afterPhoneRequest,
  afterPhoneVerify,
  PHONE_START,
} from "./phone-form-state";

const asha = { phone: "98765 43210", name: "Asha Rao" };

describe("afterPhoneRequest", () => {
  it("moves on to the code once it is texted", () => {
    expect(afterPhoneRequest({ ok: true }, asha)).toEqual({
      step: "code",
      ...asha,
      sent: true,
    });
  });

  it("stays on the phone step and marks the fields that were wrong", () => {
    expect(
      afterPhoneRequest(
        { ok: false, error: "invalid_input", fields: ["phone", "name"] },
        asha
      )
    ).toEqual({
      step: "phone",
      ...asha,
      fieldErrors: { phone: true, name: true },
    });
  });

  it.each(["unsupported_country", "sms_disabled"] as const)(
    "points %s to email from the phone step",
    (error) => {
      expect(afterPhoneRequest({ ok: false, error }, asha, "code")).toEqual({
        step: "phone",
        ...asha,
        alert: error,
      });
    }
  );

  it("says how many minutes to wait, staying on the code step if it was there", () => {
    expect(
      afterPhoneRequest(
        { ok: false, error: "rate_limited", retryAfterSeconds: 61 },
        asha,
        "code"
      )
    ).toEqual({
      step: "code",
      ...asha,
      alert: "rate_limited",
      retryAfterMinutes: 2,
    });
  });
});

describe("afterPhoneVerify", () => {
  const onCode = { step: "code" as const, ...asha, sent: true };

  it("marks a wrong code on the code field", () => {
    expect(
      afterPhoneVerify({ ok: false, error: "code_invalid" }, onCode)
    ).toEqual({ step: "code", ...asha, fieldErrors: { code: true } });
  });

  it.each(["code_expired", "too_many_attempts", "no_account"] as const)(
    "explains %s for the whole form",
    (error) => {
      expect(afterPhoneVerify({ ok: false, error }, onCode)).toEqual({
        step: "code",
        ...asha,
        alert: error,
      });
    }
  );

  it("goes back to the phone step when SMS was switched off meanwhile", () => {
    expect(
      afterPhoneVerify({ ok: false, error: "sms_disabled" }, onCode)
    ).toEqual({ step: "phone", ...asha, alert: "sms_disabled" });
  });

  it("marks a missing name or a malformed code", () => {
    expect(
      afterPhoneVerify(
        { ok: false, error: "invalid_input", fields: ["name", "code"] },
        onCode
      )
    ).toEqual({
      step: "code",
      ...asha,
      fieldErrors: { name: true, code: true },
    });
  });
});

describe("afterPhoneFailure", () => {
  it("stays on the step the form was showing", () => {
    expect(afterPhoneFailure("code", asha)).toEqual({
      step: "code",
      ...asha,
      alert: "failed",
    });
  });
});

describe("PHONE_START", () => {
  it("asks for the phone first", () => {
    expect(PHONE_START).toEqual({ step: "phone", phone: "", name: "" });
  });
});
