import { describe, expect, it } from "vitest";

import type { TaxExemptionSettings } from "../domain/tax-exemption";
import { readOfflineDonationInput, type RecordOfflineDonationInput } from "./input";

/** FOA's starting point: no tax exemption, so no PAN is ever kept. */
const OFF: TaxExemptionSettings = {
  has80G: false,
  wording: "",
  registrationNumber: "",
  validUntil: "",
};

const PROOF_ID = "0194f3a2-7c1e-7b3a-9d2f-3c4b5a6d7e8f";

/** Rs 25,000 by cheque from a person, as finance typed it. */
const CHEQUE: RecordOfflineDonationInput = {
  method: "cheque",
  reference: "004512",
  receivedOn: "2027-01-15",
  amountMinor: 2_500_000n,
  donor: { type: "individual", name: "Asha Rao", email: "asha@example.org" },
  proofFileId: PROOF_ID,
};

describe("readOfflineDonationInput", () => {
  it("reads a cheque from a person into the entry to record", () => {
    expect(readOfflineDonationInput(CHEQUE, OFF)).toEqual({
      ok: true,
      entry: {
        method: "cheque",
        reference: "004512",
        receivedOn: "2027-01-15",
        amountMinor: 2_500_000n,
        donor: {
          type: "individual",
          name: "Asha Rao",
          email: "asha@example.org",
          phone: null,
          address: null,
          organisationName: null,
        },
        proofFileId: PROOF_ID,
        pan: null,
      },
    });
  });

  it("refuses an entry whose proof was never uploaded", () => {
    // The form's hidden proof field is empty until an upload finishes.
    expect(readOfflineDonationInput({ ...CHEQUE, proofFileId: "" }, OFF)).toEqual(
      { ok: false, error: "invalid_input", fields: ["proofFileId"] }
    );
  });

  it("names every field that can't be read, at once", () => {
    expect(
      readOfflineDonationInput(
        {
          ...CHEQUE,
          donor: { type: "individual", name: "   ", email: "asha at example" },
          proofFileId: "not-a-file-id",
        },
        OFF
      )
    ).toEqual({
      ok: false,
      error: "invalid_input",
      fields: ["donor.name", "donor.email", "proofFileId"],
    });
  });
});
