import { describe, expect, it } from "vitest";

import { campaignHref, readOutcome } from "./href";

const ID = "01938a00-0000-7000-8000-00000000a001";

describe("campaign page outcomes", () => {
  it("round-trips a change that worked and a refusal", () => {
    expect(campaignHref(ID)).toBe(`/admin/campaigns/${ID}`);
    expect(campaignHref(ID, { done: "sent" }, 5)).toBe(
      `/admin/campaigns/${ID}?done=sent&at=5`
    );
    expect(readOutcome({ done: "sent", at: "5" })).toEqual({
      done: "sent",
      at: "5",
    });
    expect(readOutcome({ refused: "segment_empty" })).toEqual({
      refused: "segment_empty",
      at: "",
    });
  });

  it("ignores junk", () => {
    expect(readOutcome({ done: "deleted" })).toBeNull();
    expect(readOutcome({ refused: "<script>" })).toBeNull();
  });
});
