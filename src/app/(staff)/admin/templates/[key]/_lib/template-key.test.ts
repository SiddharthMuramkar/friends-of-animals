import { describe, expect, it } from "vitest";

import { templateKeyOf } from "./template-key";

describe("templateKeyOf", () => {
  it("decodes an escaped key from the editor's path", () => {
    expect(templateKeyOf("identity%2Ewelcome")).toBe("identity.welcome");
  });

  it("keeps a key that has nothing to decode", () => {
    expect(templateKeyOf("identity.welcome")).toBe("identity.welcome");
  });

  it("keeps a malformed escape as it is, so the lookup says not found instead of throwing", () => {
    expect(templateKeyOf("%")).toBe("%");
    expect(templateKeyOf("%E0%A4")).toBe("%E0%A4");
  });
});
