import { describe, expect, it } from "vitest";

import { DomainError } from "@/server/errors";

import { afterChange, afterError, IDLE } from "./form-state";

describe("afterChange", () => {
  it("says a stored value was saved, or that it already applied", () => {
    expect(afterChange({ ok: true, changed: true }, "8")).toEqual({
      status: "saved",
    });
    expect(afterChange({ ok: true, changed: false }, "12")).toEqual({
      status: "unchanged",
    });
  });

  it("keeps what was typed beside the reason it was refused", () => {
    expect(
      afterChange(
        {
          ok: false,
          error: "invalid_value",
          problem: { reason: "too_big", max: 24 },
        },
        "25"
      )
    ).toEqual({
      status: "invalid",
      problem: { reason: "too_big", max: 24 },
      entered: "25",
    });
  });

  it("asks for a reload when the setting is gone", () => {
    expect(afterChange({ ok: false, error: "unknown_setting" }, "on")).toEqual({
      status: "refused",
      reason: "unknown_setting",
    });
  });
});

describe("afterError", () => {
  it.each([
    "forbidden",
    "step_up_required",
    "second_factor_required",
    "enrolment_required",
  ] as const)("names the refusal %s", (code) => {
    expect(afterError(new DomainError(code, "refused"))).toEqual({
      status: "refused",
      reason: code,
    });
  });

  it("says anything else failed, without its message", () => {
    expect(afterError(new Error("select … from setting"))).toEqual({
      status: "refused",
      reason: "failed",
    });
  });
});

it("starts with nothing to say", () => {
  expect(IDLE).toEqual({ status: "idle" });
});
