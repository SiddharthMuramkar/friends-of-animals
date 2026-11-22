import { describe, expect, it } from "vitest";

import { AUDIENCES } from "@/content/stories";

import { POST_AUDIENCES } from "./post-kinds";

describe("POST_AUDIENCES", () => {
  it("are the published stories' audiences, so every story imports", () => {
    expect(POST_AUDIENCES).toEqual(AUDIENCES);
  });
});
