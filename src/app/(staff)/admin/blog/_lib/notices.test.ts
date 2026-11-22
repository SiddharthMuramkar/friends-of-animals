import { describe, expect, it } from "vitest";

import { altRefusal, noticeOf, noticeQuery, refusalCode } from "./notices";

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

describe("why a move wasn't made", () => {
  it("names a refusal it knows, and any other as failed, never as done", () => {
    expect(refusalCode("not_in_future")).toBe("not_in_future");
    expect(refusalCode("image_not_ready")).toBe("image_not_ready");

    const query = new URLSearchParams(
      noticeQuery("scheduled", refusalCode("a_code_added_later"))
    );

    expect(noticeOf(Object.fromEntries(query))).toMatchObject({
      kind: "scheduled",
      refused: "failed",
    });
  });
});

describe("why alt text wasn't saved", () => {
  it("names a cover a live post needs described apart from text that is too long", () => {
    expect(
      altRefusal({
        ok: false,
        error: "invalid_input",
        fields: ["coverAlt"],
        errors: { coverAlt: "required" },
      })
    ).toBe("cover_alt_required");
    expect(
      altRefusal({
        ok: false,
        error: "invalid_input",
        fields: ["alt"],
        errors: { alt: "too_long" },
      })
    ).toBe("too_long");
    expect(
      altRefusal({
        ok: false,
        error: "invalid_input",
        fields: ["excerpt"],
        errors: { excerpt: "required" },
      })
    ).toBe("invalid_input");
  });

  it("passes the other refusals on as they are", () => {
    expect(altRefusal({ ok: false, error: "archived" })).toBe("archived");
    expect(altRefusal({ ok: false, error: "image_not_ready" })).toBe(
      "image_not_ready"
    );
    expect(altRefusal({ ok: false, error: "not_found" })).toBe("not_found");
    expect(altRefusal({ ok: false, error: "a_code_added_later" })).toBe(
      "failed"
    );
  });
});
