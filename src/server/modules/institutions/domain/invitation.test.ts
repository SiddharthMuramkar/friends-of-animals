import { describe, expect, it } from "vitest";

import {
  decideInvitation,
  INVITATION_TTL_MS,
  invitationExpiresAt,
  invitationStatus,
  type InvitationAction,
  type InvitationState,
} from "./invitation";

const SENT_AT = new Date("2027-01-15T04:30:00.000Z");
const EXPIRES_AT = new Date("2027-01-22T04:30:00.000Z");
const BEFORE_EXPIRY = new Date("2027-01-22T04:29:59.999Z");

const pending: InvitationState = { status: "pending", expiresAt: EXPIRES_AT };
const accepted: InvitationState = { status: "accepted", expiresAt: EXPIRES_AT };
const revoked: InvitationState = { status: "revoked", expiresAt: EXPIRES_AT };

describe("invitationExpiresAt", () => {
  it("gives an invitation seven days", () => {
    expect(INVITATION_TTL_MS).toBe(604_800_000);
    expect(invitationExpiresAt(SENT_AT)).toEqual(EXPIRES_AT);
  });

  it("takes another lifetime when one is given", () => {
    expect(invitationExpiresAt(SENT_AT, 60_000)).toEqual(
      new Date("2027-01-15T04:31:00.000Z")
    );
  });
});

describe("invitationStatus", () => {
  it("is pending until the last millisecond before expiry", () => {
    expect(invitationStatus(pending, SENT_AT)).toBe("pending");
    expect(invitationStatus(pending, BEFORE_EXPIRY)).toBe("pending");
  });

  it("is expired from the expiry instant on", () => {
    expect(invitationStatus(pending, EXPIRES_AT)).toBe("expired");
    expect(invitationStatus(pending, new Date("2027-03-01T00:00:00Z"))).toBe(
      "expired"
    );
  });

  it("keeps accepted and revoked after expiry", () => {
    expect(invitationStatus(accepted, EXPIRES_AT)).toBe("accepted");
    expect(invitationStatus(revoked, EXPIRES_AT)).toBe("revoked");
  });
});

describe("decideInvitation", () => {
  // Every effective status against every action. Accepting needs a live
  // invitation; withdrawing works on any invitation still pending, expired
  // or not, so inviting the same person again can replace an old link.
  const table: Array<{
    from: string;
    state: InvitationState;
    now: Date;
    action: InvitationAction;
    expected: ReturnType<typeof decideInvitation>;
  }> = [
    {
      from: "pending",
      state: pending,
      now: BEFORE_EXPIRY,
      action: "accept",
      expected: { ok: true, status: "accepted" },
    },
    {
      from: "pending",
      state: pending,
      now: BEFORE_EXPIRY,
      action: "revoke",
      expected: { ok: true, status: "revoked" },
    },
    {
      from: "expired",
      state: pending,
      now: EXPIRES_AT,
      action: "accept",
      expected: { ok: false, reason: "expired" },
    },
    {
      from: "expired",
      state: pending,
      now: EXPIRES_AT,
      action: "revoke",
      expected: { ok: true, status: "revoked" },
    },
    {
      from: "accepted",
      state: accepted,
      now: BEFORE_EXPIRY,
      action: "accept",
      expected: { ok: false, reason: "already_accepted" },
    },
    {
      from: "accepted",
      state: accepted,
      now: BEFORE_EXPIRY,
      action: "revoke",
      expected: { ok: false, reason: "already_accepted" },
    },
    {
      from: "revoked",
      state: revoked,
      now: BEFORE_EXPIRY,
      action: "accept",
      expected: { ok: false, reason: "revoked" },
    },
    {
      from: "revoked",
      state: revoked,
      now: BEFORE_EXPIRY,
      action: "revoke",
      expected: { ok: false, reason: "revoked" },
    },
  ];

  it.each(table)(
    "$action from $from gives $expected",
    ({ state, now, action, expected }) => {
      expect(decideInvitation(action, state, now)).toEqual(expected);
    }
  );

  it("refuses a second accept once the first is stored", () => {
    const first = decideInvitation("accept", pending, SENT_AT);
    expect(first).toEqual({ ok: true, status: "accepted" });
    if (!first.ok) return;
    expect(
      decideInvitation(
        "accept",
        { status: first.status, expiresAt: EXPIRES_AT },
        SENT_AT
      )
    ).toEqual({ ok: false, reason: "already_accepted" });
  });
});
