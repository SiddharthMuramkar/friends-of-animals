import { describe, expect, it } from "vitest";

import {
  newRequestErrorFrom,
  newRequestErrorHref,
  viewOutcomeFrom,
  viewOutcomeHref,
} from "./outcome";

const ID = "0190a000-0000-7000-8000-0000000000aa";

describe("the privacy pages' outcomes", () => {
  it("round-trips each outcome through the address", () => {
    expect(newRequestErrorHref("already_open")).toBe(
      "/dashboard/privacy/new?error=already_open"
    );
    expect(newRequestErrorFrom({ error: "already_open" })).toBe("already_open");
    expect(viewOutcomeHref(ID, { result: "filed" })).toBe(
      `/dashboard/privacy/${ID}?result=filed`
    );
    expect(viewOutcomeFrom({ result: "filed" })).toEqual({
      kind: "result",
      key: "filed",
    });
    expect(viewOutcomeFrom({ error: "link_expired" })).toEqual({
      kind: "error",
      key: "link_expired",
    });
  });

  it("ignores keys the pages don't know", () => {
    expect(newRequestErrorFrom({ error: "<b>hi</b>" })).toBeNull();
    expect(viewOutcomeFrom({ result: "hacked", error: ["x"] })).toBeNull();
  });
});
