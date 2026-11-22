import { describe, expect, it } from "vitest";

import { noticeAfterGive } from "./notice";

describe("noticeAfterGive", () => {
  it("says it worked when consent is recorded, or was already given", () => {
    expect(noticeAfterGive({ ok: true, changed: true })).toBe("given");
    expect(noticeAfterGive({ ok: true, changed: false })).toBe("given");
  });

  it("says the text changed only when staff published a newer version", () => {
    expect(noticeAfterGive({ ok: false, error: "document_outdated" })).toBe(
      "outdated"
    );
  });

  it("says nothing was saved for any other refusal", () => {
    expect(noticeAfterGive({ ok: false, error: "no_published_document" })).toBe(
      "failed"
    );
    expect(
      noticeAfterGive({
        ok: false,
        error: "invalid_input",
        fields: ["documentId"],
      })
    ).toBe("failed");
  });
});
