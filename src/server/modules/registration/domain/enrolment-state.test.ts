import { describe, expect, it } from "vitest";

import { enrolmentState } from "./enrolment-state";

describe("enrolmentState", () => {
  it.each([
    ["open", "verified", "open"],
    ["not_open_yet", "verified", "not_open_yet"],
    ["closed", "verified", "closed"],
    ["unpublished", "verified", "closed"],
    ["open", "suspended", "institution_not_verified"],
    ["closed", "suspended", "institution_not_verified"],
  ] as const)(
    "with registration %s and the institution %s, says %s",
    (window, institutionStatus, state) => {
      expect(enrolmentState({ window, institutionStatus })).toBe(state);
    }
  );
});
