import { describe, expect, it } from "vitest";

import {
  inviteFormState,
  isManageOutcome,
  removeOutcome,
  withdrawOutcome,
} from "./invite-state";

describe("inviteFormState", () => {
  it("clears the field and says who it went to once sent", () => {
    expect(
      inviteFormState(" t@school.test ", {
        ok: true,
        invitationId: "01938a00-0000-7000-8000-000000000001",
        expiresAt: new Date(0),
      })
    ).toEqual({ identifier: "", sentTo: "t@school.test" });
  });

  it("keeps what was typed beside the problem", () => {
    expect(
      inviteFormState("12345", {
        ok: false,
        error: "invalid_input",
        fields: ["identifier"],
      })
    ).toEqual({ identifier: "12345", problem: "invalid_input" });
    expect(
      inviteFormState("98765 43210", { ok: false, error: "sms_disabled" })
    ).toEqual({ identifier: "98765 43210", problem: "sms_disabled" });
  });
});

describe("manage outcomes", () => {
  it("maps each result to what the page says", () => {
    expect(removeOutcome({ ok: true })).toBe("removed");
    expect(removeOutcome({ ok: false, error: "not_found" })).toBe("not_found");
    expect(withdrawOutcome({ ok: true })).toBe("withdrawn");
    expect(withdrawOutcome({ ok: false, error: "already_accepted" })).toBe(
      "already_accepted"
    );
    expect(
      withdrawOutcome({ ok: false, error: "invalid_input", fields: ["x"] })
    ).toBe("not_found");
  });

  it("accepts only known outcomes from the address bar", () => {
    expect(isManageOutcome("removed")).toBe(true);
    expect(isManageOutcome("<script>")).toBe(false);
    expect(isManageOutcome(undefined)).toBe(false);
  });
});
