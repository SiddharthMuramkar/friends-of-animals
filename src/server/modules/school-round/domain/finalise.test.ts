import { describe, expect, it } from "vitest";

import { planFinalisation, type FinaliseFacts } from "./finalise";

// A round ready to finalise: a panel, conduct certified by #87, the judging
// attested in the finalise form. e1 and e2 are picked (e1 placed first);
// e3 was submitted but not picked; e4 never reached `submitted`.
const READY: FinaliseFacts = {
  panelSize: 2,
  conductCertified: true,
  judgingAttested: true,
  entries: [
    { entryId: "e1", submitted: true },
    { entryId: "e2", submitted: true },
    { entryId: "e3", submitted: true },
    { entryId: "e4", submitted: false },
  ],
  picks: [
    { entryId: "e1", position: 1 },
    { entryId: "e2", position: null },
  ],
};

describe("planFinalisation()", () => {
  it("shortlists the picked entries straight through to FOA and marks every other entry not shortlisted", () => {
    expect(planFinalisation(READY)).toEqual({
      ok: true,
      outcomes: [
        {
          entryId: "e1",
          outcome: "shortlisted",
          position: 1,
          statuses: ["school_shortlisted", "submitted_to_foa"],
        },
        {
          entryId: "e2",
          outcome: "shortlisted",
          position: null,
          statuses: ["school_shortlisted", "submitted_to_foa"],
        },
        {
          entryId: "e3",
          outcome: "not_shortlisted",
          position: null,
          statuses: ["not_shortlisted"],
        },
        {
          entryId: "e4",
          outcome: "not_shortlisted",
          position: null,
          statuses: ["not_shortlisted"],
        },
      ],
    });
  });

  it.each([
    [{ panelSize: 0 }, "panel_missing"],
    [{ conductCertified: false }, "conduct_not_certified"],
    [{ judgingAttested: false }, "judging_not_attested"],
  ] as const)("is blocked by %o", (change, code) => {
    expect(planFinalisation({ ...READY, ...change })).toEqual({
      ok: false,
      blockers: [{ code }],
    });
  });

  it("refuses a pick that is not one of the round's entries, or was never submitted", () => {
    expect(
      planFinalisation({
        ...READY,
        picks: [
          { entryId: "e1", position: 1 },
          { entryId: "elsewhere", position: null },
          { entryId: "e4", position: 2 },
        ],
      })
    ).toEqual({
      ok: false,
      blockers: [
        { code: "pick_not_in_round", entryId: "elsewhere" },
        { code: "pick_not_submitted", entryId: "e4" },
      ],
    });
  });

  it("finalises a round with no entries", () => {
    expect(planFinalisation({ ...READY, entries: [], picks: [] })).toEqual({
      ok: true,
      outcomes: [],
    });
  });

  it("lists every blocker at once, so the page can show a checklist", () => {
    expect(
      planFinalisation({
        ...READY,
        panelSize: 0,
        conductCertified: false,
        judgingAttested: false,
      })
    ).toEqual({
      ok: false,
      blockers: [
        { code: "panel_missing" },
        { code: "conduct_not_certified" },
        { code: "judging_not_attested" },
      ],
    });
  });
});
