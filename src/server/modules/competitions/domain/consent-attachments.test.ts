import { describe, expect, it } from "vitest";

import {
  ATTACHABLE_PURPOSES,
  attachmentState,
  decideAttach,
  documentVersionPath,
  isGuardianDocument,
  isRequiredForRegistration,
  parseDocumentVersionPath,
} from "./consent-attachments";

const v1 = { id: "doc-terms-v1", version: 1 };
const v2 = { id: "doc-terms-v2", version: 2 };

describe("attachable purposes", () => {
  it("lists the competition terms, the privacy notice and the guardian consent documents (#82)", () => {
    expect(ATTACHABLE_PURPOSES).toEqual([
      "competition_terms",
      "privacy_notice",
      "participation",
      "public_display",
      "social_media",
      "auction",
    ]);
  });

  it("requires the terms and the privacy notice before anyone registers", () => {
    expect(isRequiredForRegistration("competition_terms")).toBe(true);
    expect(isRequiredForRegistration("privacy_notice")).toBe(true);
  });

  it("leaves the guardian documents to the guardian, one consent at a time", () => {
    for (const purpose of [
      "participation",
      "public_display",
      "social_media",
      "auction",
    ] as const) {
      expect(isRequiredForRegistration(purpose)).toBe(false);
      expect(isGuardianDocument(purpose)).toBe(true);
    }
    expect(isGuardianDocument("competition_terms")).toBe(false);
    expect(isGuardianDocument("privacy_notice")).toBe(false);
  });

  it("gives each guardian document a public path", () => {
    expect(documentVersionPath("public_display", 2)).toBe(
      "/documents/public-display/2"
    );
    expect(parseDocumentVersionPath("social-media", "1")).toEqual({
      purpose: "social_media",
      version: 1,
    });
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

describe("document version paths", () => {
  it("link a purpose's version under /documents, in kebab case", () => {
    expect(documentVersionPath("competition_terms", 2)).toBe(
      "/documents/competition-terms/2"
    );
    expect(documentVersionPath("privacy_notice", 1)).toBe(
      "/documents/privacy-notice/1"
    );
  });

  it("read back to the purpose and version", () => {
    expect(parseDocumentVersionPath("competition-terms", "2")).toEqual({
      purpose: "competition_terms",
      version: 2,
    });
  });

  it.each([
    ["messages", "1"],
    ["competition_terms", "1"],
    ["terms", "1"],
    ["competition-terms", "0"],
    ["competition-terms", "02"],
    ["competition-terms", "1.5"],
    ["competition-terms", "v1"],
    ["competition-terms", "2147483648"],
  ])("refuse %j version %j", (purpose, version) => {
    expect(parseDocumentVersionPath(purpose, version)).toBeNull();
  });
});
