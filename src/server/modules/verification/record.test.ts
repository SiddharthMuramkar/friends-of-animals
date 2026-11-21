import { describe, expect, it } from "vitest";

import type { Actor } from "@/server/actor";
import { createHarness } from "@/test/harness";

import { applyVerification, verificationHistory } from "./record";

const NOW = new Date("2027-03-01T04:30:00.000Z");

/** Any entry id: the record keeps decisions by id alone. */
const ENTRY_ID = "0195a1b2-c3d4-7e5f-8a6b-7c8d9e0f1a2b";

/** A signed-in user. The record never reads the session. */
function signedIn(userId: string): Actor {
  return {
    kind: "user",
    userId,
    sessionId: "0195a1b2-c3d4-7e5f-8a6b-000000000001",
    meta: { ip: "203.0.113.10", userAgent: "Seam 1 test" },
  };
}

describe("the verification record", () => {
  it("keeps a verifier's verify decision in the entry's history", async () => {
    const h = await createHarness({ now: NOW });
    const verifier = await h.seed.member();

    const decision = await applyVerification(
      h.db,
      { clock: h.clock, actor: signedIn(verifier.id) },
      { id: ENTRY_ID, status: "submitted_to_foa" },
      { kind: "verify" }
    );

    expect(decision).toEqual({
      ok: true,
      to: "foa_verified",
      event: "entry.foa_verified",
    });
    expect(await verificationHistory(h.db, ENTRY_ID)).toEqual([
      {
        decision: "verified",
        reason: null,
        decidedByUserId: verifier.id,
        decidedAt: NOW,
        resubmissionDueAt: null,
        resubmission: null,
      },
    ]);
  });
});
