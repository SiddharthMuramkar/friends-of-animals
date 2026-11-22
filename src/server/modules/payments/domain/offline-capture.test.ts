import { describe, expect, it } from "vitest";

import type { FileStatus } from "@/server/modules/files/domain/file-status";

import type { PaymentBatchStatus } from "./batch-status";
import { decideOfflineCapture, type OfflineCapture } from "./offline-capture";
import type { RegistrationAtCapture } from "./review-case";

const FINANCE = "01938a00-0000-7000-8000-000000000201";
const OTHER_FINANCE = "01938a00-0000-7000-8000-000000000202";

// 10:00 IST on 15 January 2027.
const NOW = new Date("2027-01-15T04:30:00.000Z");

const registration = (
  overrides: Partial<RegistrationAtCapture> = {}
): RegistrationAtCapture => ({
  registrationId: "01938a00-0000-7000-8000-000000000301",
  standing: "awaiting_payment",
  windowOpen: true,
  heldByThisBatch: true,
  ...overrides,
});

/** A cheque for a batch of two, with the recorder's own clean proof. */
const capture = (overrides: Partial<OfflineCapture> = {}): OfflineCapture => ({
  batch: { status: "order_created", amountMinor: 900_00n },
  registrations: [
    registration(),
    registration({ registrationId: "01938a00-0000-7000-8000-000000000302" }),
  ],
  proof: {
    ownerUserId: FINANCE,
    purpose: "offline_payment_proof",
    status: "clean",
  },
  recordedBy: FINANCE,
  payment: {
    method: "cheque",
    reference: " 004 512 ",
    amountMinor: 900_00n,
    receivedOn: "2027-01-14",
  },
  now: NOW,
  ...overrides,
});

describe("decideOfflineCapture()", () => {
  it("accepts a cheque for exactly the batch's amount, with its reference as stored", () => {
    expect(decideOfflineCapture(capture())).toEqual({
      ok: true,
      payment: {
        method: "cheque",
        reference: "004512",
        amountMinor: 900_00n,
        receivedOn: "2027-01-14",
      },
    });
  });

  it("accepts a batch whose gateway order isn't open yet", () => {
    expect(
      decideOfflineCapture(
        capture({ batch: { status: "created", amountMinor: 900_00n } })
      ).ok
    ).toBe(true);
  });

  it("refuses a batch that is paid already, so a double submit records nothing", () => {
    expect(
      decideOfflineCapture(
        capture({ batch: { status: "captured", amountMinor: 900_00n } })
      )
    ).toEqual({ ok: false, error: "already_paid" });
  });

  it.each(["failed", "cancelled", "needs_review"] as const)(
    "refuses a %s batch",
    (status: PaymentBatchStatus) => {
      expect(
        decideOfflineCapture(
          capture({ batch: { status, amountMinor: 900_00n } })
        )
      ).toEqual({ ok: false, error: "batch_not_payable" });
    }
  );

  it("reports every field that is wrong at once", () => {
    expect(
      decideOfflineCapture(
        capture({
          payment: {
            method: "bank_transfer",
            reference: "UTR#1",
            amountMinor: 899_99n,
            receivedOn: "2027-01-16",
          },
        })
      )
    ).toEqual({
      ok: false,
      error: "fields_invalid",
      errors: {
        reference: "reference_invalid",
        amountMinor: "amount_mismatch",
        receivedOn: "received_in_future",
      },
    });
  });

  it("refuses a missing proof", () => {
    expect(decideOfflineCapture(capture({ proof: null }))).toEqual({
      ok: false,
      error: "proof_invalid",
    });
  });

  it("refuses a proof someone else uploaded", () => {
    expect(
      decideOfflineCapture(capture({ recordedBy: OTHER_FINANCE }))
    ).toEqual({ ok: false, error: "proof_invalid" });
  });

  it("refuses a file uploaded for another purpose", () => {
    expect(
      decideOfflineCapture(
        capture({
          proof: {
            ownerUserId: FINANCE,
            purpose: "test_upload",
            status: "clean",
          },
        })
      )
    ).toEqual({ ok: false, error: "proof_invalid" });
  });

  it.each([
    ["uploaded", true],
    ["scanning", true],
    ["clean", true],
    ["pending_upload", false],
    ["quarantined", false],
    ["rejected", false],
    ["deleted", false],
  ] as const)(
    "takes a proof that is %s: %s",
    (status: FileStatus, accepted) => {
      const decision = decideOfflineCapture(
        capture({
          proof: {
            ownerUserId: FINANCE,
            purpose: "offline_payment_proof",
            status,
          },
        })
      );
      expect(decision.ok ? "accepted" : decision.error).toBe(
        accepted ? "accepted" : "proof_invalid"
      );
    }
  );

  it.each(["cancelled", "paid"] as const)(
    "refuses a batch with a registration that is %s",
    (standing) => {
      expect(
        decideOfflineCapture(
          capture({
            registrations: [registration(), registration({ standing })],
          })
        )
      ).toEqual({ ok: false, error: "registration_not_payable" });
    }
  );

  it("refuses a batch that no longer holds one of its registrations", () => {
    expect(
      decideOfflineCapture(
        capture({ registrations: [registration({ heldByThisBatch: false })] })
      )
    ).toEqual({ ok: false, error: "registration_not_payable" });
  });

  it("refuses a batch with no registration left to confirm", () => {
    expect(decideOfflineCapture(capture({ registrations: [] }))).toEqual({
      ok: false,
      error: "registration_not_payable",
    });
  });

  it("records money that arrived after the competition stopped taking registrations", () => {
    expect(
      decideOfflineCapture(
        capture({ registrations: [registration({ windowOpen: false })] })
      ).ok
    ).toBe(true);
  });

  it("checks the batch, then the fields, then the proof, then the registrations", () => {
    const wrongFields = {
      method: "cheque",
      reference: "12",
      amountMinor: 900_00n,
      receivedOn: "2027-01-14",
    } as const;
    const cancelled = [registration({ standing: "cancelled" })];

    expect(
      decideOfflineCapture(
        capture({
          batch: { status: "captured", amountMinor: 900_00n },
          payment: wrongFields,
          proof: null,
          registrations: cancelled,
        })
      )
    ).toEqual({ ok: false, error: "already_paid" });
    expect(
      decideOfflineCapture(
        capture({ payment: wrongFields, proof: null, registrations: cancelled })
      )
    ).toMatchObject({ ok: false, error: "fields_invalid" });
    expect(
      decideOfflineCapture(capture({ proof: null, registrations: cancelled }))
    ).toEqual({ ok: false, error: "proof_invalid" });
  });
});
