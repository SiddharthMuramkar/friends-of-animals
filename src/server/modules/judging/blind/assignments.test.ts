import { describe, expect, it } from "vitest";
import { createHarness } from "@/test/harness";
import { scoringWorld } from "../blind-testing";

describe("listMyAssignments", () => {
  it("shows only the judge's assigned work in an open round, and requires current onboarding", async () => {
    const h = await createHarness();
    const w = await scoringWorld(h);
    expect(
      await h.as(w.judge).listMyAssignments({ roundId: w.roundId })
    ).toMatchObject({
      ok: true,
      entries: [
        {
          entryCode: w.code,
          discipline: "photography",
          progress: "not_started",
        },
      ],
    });
    expect(
      await h.as(w.otherJudge).listMyAssignments({ roundId: w.roundId })
    ).toMatchObject({
      ok: true,
      entries: [{ entryCode: w.otherCode }],
    });
    expect(
      await h.as(w.newJudge).listMyAssignments({ roundId: w.roundId })
    ).toEqual({ ok: false, error: "not_onboarded" });
    for (const actor of [w.manager, h.visitor(), w.outsider]) {
      expect(
        await h.as(actor).listMyAssignments({ roundId: w.roundId })
      ).toEqual({ ok: false, error: "entry_not_found" });
    }
  });
});
