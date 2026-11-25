import { describe, expect, it } from "vitest";

import { planFinalisation, type FinaliseFacts } from "./finalise";

// An overdue round the school never finished: no panel recorded, conduct
// not certified, nothing attested. e1 is picked and placed first, e2 was
// submitted but not picked, and e3 never reached `submitted`.
const UNFINISHED: FinaliseFacts = {
  panelSize: 0,
  conductCertified: false,
  judgingAttested: false,
  entries: [
    { entryId: "e1", submitted: true },
    { entryId: "e2", submitted: true },
    { entryId: "e3", submitted: false },
  ],
  picks: [{ entryId: "e1", position: 1 }],
};

const NOT_SHORTLISTED = {
  outcome: "not_shortlisted",
  position: null,
  statuses: ["not_shortlisted"],
} as const;

describe("planFinalisation() when a competition manager closes the round", () => {
  it("applies the school's saved picks without its panel, conduct certification or attestation", () => {
    expect(planFinalisation({ ...UNFINISHED, by: "manager" })).toEqual({
      ok: true,
      outcomes: [
        {
          entryId: "e1",
          outcome: "shortlisted",
          position: 1,
          statuses: ["school_shortlisted", "submitted_to_foa"],
        },
        { entryId: "e2", ...NOT_SHORTLISTED },
        { entryId: "e3", ...NOT_SHORTLISTED },
      ],
    });
  });

  it("marks every entry not shortlisted when the school saved no picks", () => {
    expect(
      planFinalisation({ ...UNFINISHED, picks: [], by: "manager" })
    ).toEqual({
      ok: true,
      outcomes: [
        { entryId: "e1", ...NOT_SHORTLISTED },
        { entryId: "e2", ...NOT_SHORTLISTED },
        { entryId: "e3", ...NOT_SHORTLISTED },
      ],
    });
  });

  it("still refuses saved picks the shortlist rules never allowed", () => {
    expect(
      planFinalisation({
        ...UNFINISHED,
        picks: [
          { entryId: "elsewhere", position: null },
          { entryId: "e3", position: 2 },
        ],
        by: "manager",
      })
    ).toEqual({
      ok: false,
      blockers: [
        { code: "pick_not_in_round", entryId: "elsewhere" },
        { code: "pick_not_submitted", entryId: "e3" },
      ],
    });
  });

  it("holds the school itself to the panel, conduct certification and attestation", () => {
    expect(planFinalisation({ ...UNFINISHED, by: "school" })).toEqual({
      ok: false,
      blockers: [
        { code: "panel_missing" },
        { code: "conduct_not_certified" },
        { code: "judging_not_attested" },
      ],
    });
  });
});
