import { describe, expect, it } from "vitest";

import { previewExitPath } from "./cms-preview-path";

describe("previewExitPath", () => {
  it("goes back to the public page that was being previewed", () => {
    expect(previewExitPath("/privacy")).toBe("/privacy");
    expect(previewExitPath("/child-protection-policy")).toBe(
      "/child-protection-policy"
    );
    expect(previewExitPath("/")).toBe("/");
  });

  it("goes home rather than anywhere it wasn't asked to preview", () => {
    for (const path of [
      "https://evil.example/privacy",
      "//evil.example",
      "/admin/cms",
      "/privacy?next=//evil.example",
      "",
      null,
    ]) {
      expect(previewExitPath(path)).toBe("/");
    }
  });
});
