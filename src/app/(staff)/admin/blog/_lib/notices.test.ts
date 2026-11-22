import { describe, expect, it } from "vitest";

import { noticeOf, noticeQuery } from "./notices";

describe("the editor's notices", () => {
  it("round-trips what was done, with a fresh key each time", () => {
    const query = new URLSearchParams(noticeQuery("published"));

    const notice = noticeOf(Object.fromEntries(query));

    expect(notice).toEqual({
      kind: "published",
      refused: null,
      key: expect.stringMatching(/^published-[a-z0-9]+$/),
    });
  });

  it("round-trips why something was refused", () => {
    const query = new URLSearchParams(
      noticeQuery("scheduled", "not_in_future")
    );

    expect(noticeOf(Object.fromEntries(query))).toMatchObject({
      kind: "scheduled",
      refused: "not_in_future",
    });
  });

  it("ignores anything it didn't write", () => {
    expect(noticeOf({})).toBeNull();
    expect(noticeOf({ notice: "deleted-abc" })).toBeNull();
    expect(noticeOf({ notice: "saved-abc", refused: "nonsense" })).toEqual({
      kind: "saved",
      refused: null,
      key: "saved-abc",
    });
    expect(noticeOf({ notice: ["saved-a", "saved-b"] })).toBeNull();
  });
});
