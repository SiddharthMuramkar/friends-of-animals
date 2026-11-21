import { describe, expect, it } from "vitest";

import { createHarness } from "@/test/harness";

// A registration number, given when a registration is confirmed, names it
// on receipts and the participant dashboard. It never signs anyone in:
// sign-in codes go only to an address the person proves they hold.
const REGISTRATION_NUMBER = "NEIGH27-R-7K3M9Q";

describe("a registration number", () => {
  it.each([REGISTRATION_NUMBER, REGISTRATION_NUMBER.toLowerCase()])(
    "is refused as the address for a sign-in code, and nothing is sent (%s)",
    async (registrationNumber) => {
      const h = await createHarness();

      const result = await h
        .as(h.visitor())
        .requestEmailCode({ email: registrationNumber });

      expect(result).toEqual({
        ok: false,
        error: "invalid_input",
        fields: ["email"],
      });
      expect(h.email.sent).toEqual([]);
    }
  );
});
