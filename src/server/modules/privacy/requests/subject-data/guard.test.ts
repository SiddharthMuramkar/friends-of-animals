import { describe, expect, it } from "vitest";

import {
  assertRowsBelongToSubject,
  auctionCaptureBatchId,
  ForeignRowError,
} from "./guard";

const ME = "0190a000-0000-7000-8000-0000000000aa";
const MY_ENTRY = "0190a000-0000-7000-8000-0000000000bb";
const SOMEONE_ELSE = "0190a000-0000-7000-8000-0000000000cc";

describe("assertRowsBelongToSubject", () => {
  it("passes rows that name the subject or a row already in the export", () => {
    expect(() =>
      assertRowsBelongToSubject(
        "entry_file",
        [
          { id: "f1", entry_id: MY_ENTRY },
          { id: "f2", entry_id: MY_ENTRY },
        ],
        ["entry_id"],
        new Set([ME, MY_ENTRY])
      )
    ).not.toThrow();
    expect(() =>
      assertRowsBelongToSubject(
        "consent_event",
        [{ id: "c1", subject_id: SOMEONE_ELSE, giver_user_id: ME }],
        ["subject_id", "giver_user_id"],
        new Set([ME])
      )
    ).not.toThrow();
  });

  it("refuses a section with one foreign row, naming only its id", () => {
    const attempt = () =>
      assertRowsBelongToSubject(
        "registration",
        [
          { id: "r1", participant_profile_id: ME },
          { id: "r2", participant_profile_id: SOMEONE_ELSE },
        ],
        ["participant_profile_id"],
        new Set([ME])
      );
    expect(attempt).toThrow(ForeignRowError);
    expect(attempt).toThrow("The registration row r2 isn't the subject's");
  });

  it("refuses a row whose owner columns are all empty", () => {
    expect(() =>
      assertRowsBelongToSubject(
        "payment_batch",
        [{ id: "b1", payer_user_id: null }],
        ["payer_user_id"],
        new Set([ME])
      )
    ).toThrow(ForeignRowError);
  });
});

describe("auctionCaptureBatchId", () => {
  const evidence = {
    id: "local-event-id",
    gateway: "fake",
    order_id: "provider-order",
    type: "payment.captured",
    capture_occurred_by: new Date("2027-01-15T04:30:00Z"),
  };
  const batch = {
    id: "local-batch-id",
    gateway: "fake",
    gateway_order_id: "provider-order",
    payer_user_id: ME,
    purpose: "auction_sale",
  };
  const users = new Set([ME]);

  it("ties timing evidence to the local id of the exact payer's auction batch", () => {
    expect(auctionCaptureBatchId(evidence, [batch], users)).toBe(
      "local-batch-id"
    );
  });

  it("refuses a different gateway, order, payer or non-auction batch without disclosing provider ids", () => {
    for (const different of [
      { gateway: "razorpay" },
      { gateway_order_id: "some-other-order" },
      { gateway_order_id: null },
      { payer_user_id: SOMEONE_ELSE },
      { purpose: "registration_fee" },
    ]) {
      expect(() =>
        auctionCaptureBatchId(evidence, [{ ...batch, ...different }], users)
      ).toThrow(
        "The gateway_webhook_event row local-event-id isn't the subject's"
      );
    }
    for (const invalid of [
      { order_id: null },
      { type: "payment.failed" },
      { capture_occurred_by: null },
    ]) {
      expect(() =>
        auctionCaptureBatchId({ ...evidence, ...invalid }, [batch], users)
      ).toThrow(ForeignRowError);
    }
  });
});
