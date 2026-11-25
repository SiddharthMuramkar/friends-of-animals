import { describe, expect, it } from "vitest";

import { outcomeFromSearch, outcomeHref, outcomeOf } from "./outcome";

const ID = "0190a000-0000-7000-8000-0000000000aa";

describe("the officer's outcomes", () => {
  it("maps results and refusals to keys the page knows", () => {
    expect(outcomeOf({ ok: true }, "started")).toEqual({
      kind: "result",
      key: "started",
    });
    expect(outcomeOf({ ok: false, error: "plan_changed" }, "erasure")).toEqual({
      kind: "error",
      key: "plan_changed",
    });
    expect(outcomeOf({ ok: false, error: "made_up" }, "erasure")).toEqual({
      kind: "error",
      key: "invalid_input",
    });
  });

  it("round-trips through the address and ignores unknown keys", () => {
    const href = outcomeHref(ID, { kind: "result", key: "noted" });
    expect(href).toBe(`/admin/privacy/requests/${ID}?result=noted`);
    expect(outcomeFromSearch({ result: "noted" })).toEqual({
      kind: "result",
      key: "noted",
    });
    expect(outcomeFromSearch({ result: "<script>" })).toBeNull();
  });
});
