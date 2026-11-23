import { describe, expect, it } from "vitest";

import en from "../../../../../messages/en-IN/guardian.json";

import { isRequestAcceptError } from "./request-accept-error";

describe("isRequestAcceptError", () => {
  it("reads back every reason accepting returns, each with its words", () => {
    for (const reason of Object.keys(en.guardian.request.errors)) {
      expect(isRequestAcceptError(reason), reason).toBe(true);
    }
  });

  it("ignores anything else in the address bar", () => {
    for (const value of ["", "boom", undefined, ["expired"]]) {
      expect(isRequestAcceptError(value)).toBe(false);
    }
  });
});
