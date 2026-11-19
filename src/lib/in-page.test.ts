import { describe, expect, it } from "vitest";

import { hashTarget, isModifiedClick } from "./in-page";

describe("hashTarget()", () => {
  it("reads the id after the #", () => {
    expect(hashTarget("#what-to-report")).toBe("what-to-report");
  });

  it("decodes an encoded id", () => {
    expect(hashTarget("#caf%C3%A9")).toBe("café");
  });

  it("keeps a malformed escape as written", () => {
    expect(hashTarget("#100%")).toBe("100%");
  });

  it("rejects a bare # and other URLs", () => {
    expect(hashTarget("#")).toBeNull();
    expect(hashTarget("/about#team")).toBeNull();
    expect(hashTarget("")).toBeNull();
  });
});

describe("isModifiedClick()", () => {
  const click = {
    button: 0,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
  };

  it("treats a plain primary click as ours", () => {
    expect(isModifiedClick(click)).toBe(false);
  });

  it("leaves middle clicks and modifier clicks to the browser", () => {
    expect(isModifiedClick({ ...click, button: 1 })).toBe(true);
    expect(isModifiedClick({ ...click, metaKey: true })).toBe(true);
    expect(isModifiedClick({ ...click, ctrlKey: true })).toBe(true);
    expect(isModifiedClick({ ...click, shiftKey: true })).toBe(true);
    expect(isModifiedClick({ ...click, altKey: true })).toBe(true);
  });
});
