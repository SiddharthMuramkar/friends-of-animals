import { describe, expect, it } from "vitest";

import {
  CAMPAIGN_CHANNELS,
  CAMPAIGN_DELIVERY_STATUSES,
  CAMPAIGN_STATUSES,
  DELIVERY_SKIP_REASONS,
  decideCampaign,
  summariseDeliveries,
  type CampaignAction,
  type CampaignDecision,
  type CampaignStatus,
} from "./campaign-lifecycle";

describe("campaign enums", () => {
  it("declares every value up front", () => {
    expect([...CAMPAIGN_STATUSES]).toEqual([
      "draft",
      "sending",
      "sent",
      "cancelled",
    ]);
    expect([...CAMPAIGN_DELIVERY_STATUSES]).toEqual([
      "queued",
      "sent",
      "skipped",
      "failed",
    ]);
    expect([...DELIVERY_SKIP_REASONS]).toEqual([
      "consent_withdrawn",
      "cancelled",
    ]);
  });

  it("offers email and in-app, never SMS", () => {
    expect([...CAMPAIGN_CHANNELS]).toEqual(["email", "in_app"]);
  });
});

// The whole table, written out by hand.
const TABLE: Record<
  CampaignStatus,
  Record<CampaignAction, CampaignDecision>
> = {
  draft: {
    edit: { ok: true, next: "draft" },
    send: { ok: true, next: "sending" },
    cancel: { ok: true, next: "cancelled" },
    complete: { ok: false, reason: "not_sending" },
  },
  sending: {
    edit: { ok: false, reason: "not_draft" },
    send: { ok: false, reason: "not_draft" },
    cancel: { ok: true, next: "cancelled" },
    complete: { ok: true, next: "sent" },
  },
  sent: {
    edit: { ok: false, reason: "not_draft" },
    send: { ok: false, reason: "campaign_finished" },
    cancel: { ok: false, reason: "campaign_finished" },
    complete: { ok: false, reason: "not_sending" },
  },
  cancelled: {
    edit: { ok: false, reason: "not_draft" },
    send: { ok: false, reason: "campaign_finished" },
    cancel: { ok: false, reason: "campaign_finished" },
    complete: { ok: false, reason: "not_sending" },
  },
};

const CASES = CAMPAIGN_STATUSES.flatMap((status) =>
  (["edit", "send", "cancel", "complete"] as const).map((action) => ({
    status,
    action,
    expected: TABLE[status][action],
  }))
);

describe("decideCampaign", () => {
  it.each(CASES)("$action on $status", ({ status, action, expected }) => {
    expect(decideCampaign(status, action)).toEqual(expected);
  });

  it("never leaves a finished campaign", () => {
    for (const status of ["sent", "cancelled"] as const) {
      for (const action of ["edit", "send", "cancel", "complete"] as const) {
        expect(decideCampaign(status, action).ok).toBe(false);
      }
    }
  });
});

describe("summariseDeliveries", () => {
  it("is settled with nothing to send", () => {
    expect(summariseDeliveries([])).toEqual({
      queued: 0,
      sent: 0,
      failed: 0,
      skipped: { consentWithdrawn: 0, cancelled: 0 },
      settled: true,
    });
  });

  it("counts each outcome and isn't settled while one is queued", () => {
    expect(
      summariseDeliveries([
        { status: "sent" },
        { status: "sent" },
        { status: "queued" },
        { status: "failed" },
        { status: "skipped", reason: "consent_withdrawn" },
        { status: "skipped", reason: "cancelled" },
        { status: "skipped", reason: "cancelled" },
      ])
    ).toEqual({
      queued: 1,
      sent: 2,
      failed: 1,
      skipped: { consentWithdrawn: 1, cancelled: 2 },
      settled: false,
    });
  });

  it("is settled once nothing is queued, failures included", () => {
    expect(
      summariseDeliveries([{ status: "sent" }, { status: "failed" }]).settled
    ).toBe(true);
  });
});
