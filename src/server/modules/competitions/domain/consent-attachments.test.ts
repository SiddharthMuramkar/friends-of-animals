import { describe, expect, it } from "vitest";

import {
  ATTACHABLE_PURPOSES,
  attachmentState,
  decideAttach,
  isRequiredForRegistration,
} from "./consent-attachments";

const v1 = { id: "doc-terms-v1", version: 1 };
const v2 = { id: "doc-terms-v2", version: 2 };

describe("attachable purposes", () => {
  it("lists the competition terms and the privacy notice", () => {
    expect(ATTACHABLE_PURPOSES).toEqual([
      "competition_terms",
      "privacy_notice",
    ]);
  });

  it("requires both before anyone registers", () => {
    expect(isRequiredForRegistration("competition_terms")).toBe(true);
    expect(isRequiredForRegistration("privacy_notice")).toBe(true);
  });
});

describe("decideAttach", () => {
  it("pins the current published version", () => {
    expect(decideAttach("competition_terms", v1, null)).toEqual({
      ok: true,
      value: { documentId: "doc-terms-v1", version: 1, changed: true },
    });
  });

  it("re-attaching moves the pin to the newer version", () => {
    expect(decideAttach("competition_terms", v2, v1)).toEqual({
      ok: true,
      value: { documentId: "doc-terms-v2", version: 2, changed: true },
    });
  });

  it("re-attaching the version already pinned changes nothing", () => {
    expect(decideAttach("competition_terms", v2, v2)).toEqual({
      ok: true,
      value: { documentId: "doc-terms-v2", version: 2, changed: false },
    });
  });

  it("refuses a purpose a competition can't attach", () => {
    expect(decideAttach("messages", v1, null)).toEqual({
      ok: false,
      error: "not_attachable",
    });
  });

  it("refuses when the purpose has no published version yet", () => {
    expect(decideAttach("privacy_notice", null, null)).toEqual({
      ok: false,
      error: "no_published_version",
    });
  });
});

describe("attachmentState", () => {
  it("tells the manager when a newer version exists", () => {
    expect(attachmentState(null, v1)).toBe("not_attached");
    expect(attachmentState(v1, v1)).toBe("current");
    expect(attachmentState(v1, v2)).toBe("newer_available");
  });

  it("keeps a pin current when nothing newer is published", () => {
    expect(attachmentState(v2, null)).toBe("current");
    expect(attachmentState(null, null)).toBe("not_attached");
  });
});
