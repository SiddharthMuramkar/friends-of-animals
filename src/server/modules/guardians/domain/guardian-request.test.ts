import { describe, expect, it } from "vitest";

import { decideGuardianRequest } from "./guardian-request";

const now = new Date("2026-11-21T10:00:00Z");
const teenEmail = { channel: "email", address: "teen2@example.test" } as const;
const mother = { channel: "email", address: "mother@example.test" } as const;

describe("decideGuardianRequest", () => {
  it("sends a request to the guardian a teen names, open for 7 days", () => {
    expect(
      decideGuardianRequest({
        guardianContact: mother,
        ownContacts: [teenEmail],
        pending: null,
        now,
      })
    ).toEqual({
      ok: true,
      action: "send",
      expiresAt: new Date("2026-11-28T10:00:00Z"),
    });
  });

  it("refuses a teen naming their own email address or phone number as the guardian's", () => {
    const teenPhone = { channel: "phone", address: "+919800000002" } as const;
    for (const guardianContact of [teenEmail, teenPhone]) {
      expect(
        decideGuardianRequest({
          guardianContact,
          ownContacts: [teenEmail, teenPhone],
          pending: null,
          now,
        })
      ).toEqual({ ok: false, reason: "guardian_contact_is_self" });
    }
  });

  it("asks for the guardian's details when a teen with no guardian names nobody", () => {
    expect(
      decideGuardianRequest({
        guardianContact: null,
        ownContacts: [teenEmail],
        pending: null,
        now,
      })
    ).toEqual({ ok: false, reason: "guardian_details_required" });
  });

  it("sends nothing new when the same guardian was asked and the link still works", () => {
    expect(
      decideGuardianRequest({
        guardianContact: mother,
        ownContacts: [teenEmail],
        pending: {
          sameContact: true,
          expiresAt: new Date("2026-11-25T10:00:00Z"),
        },
        now,
      })
    ).toEqual({ ok: true, action: "reuse" });
  });
});
