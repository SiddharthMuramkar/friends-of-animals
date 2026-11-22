import { describe, expect, it } from "vitest";

import { LEGAL_DOCS, type LegalDocId } from "../../../../content/legal";
import {
  CMS_DOCUMENT_KEYS,
  ORG_FACTS_TAG,
  cmsTag,
  isCmsDocumentKey,
  isLinkedConsentPurpose,
  isMirroredConsentPurpose,
  legalDocumentKey,
  legalKeyForConsentPurpose,
  tagsToRefresh,
} from "./documents";

describe("the CMS document registry", () => {
  it("lists the eight documents #111 edits", () => {
    expect(CMS_DOCUMENT_KEYS).toEqual([
      "home",
      "about",
      "impact",
      "site_facts",
      "legal_privacy",
      "legal_terms",
      "legal_safeguarding",
      "legal_child_protection",
    ]);
  });

  it("recognises its keys and nothing else", () => {
    expect(isCmsDocumentKey("legal_terms")).toBe(true);
    expect(isCmsDocumentKey("blog")).toBe(false);
    expect(isCmsDocumentKey("toString")).toBe(false);
  });

  it("has one CMS document for each policy page", () => {
    const ids = Object.keys(LEGAL_DOCS) as LegalDocId[];
    const keys = ids.map(legalDocumentKey);
    expect(new Set(keys).size).toBe(ids.length);
    for (const key of keys) expect(key.startsWith("legal_")).toBe(true);
  });

  it("links each consent purpose to the policy page it rests on", () => {
    expect(legalKeyForConsentPurpose("privacy_notice")).toBe("legal_privacy");
    expect(legalKeyForConsentPurpose("terms")).toBe("legal_terms");
    expect(legalKeyForConsentPurpose("messages")).toBe("legal_privacy");
  });

  it("says a competition's terms rest on no policy page", () => {
    for (const purpose of ["privacy_notice", "terms", "messages"]) {
      expect(isLinkedConsentPurpose(purpose), purpose).toBe(true);
    }
    expect(isLinkedConsentPurpose("competition_terms")).toBe(false);
    expect(isLinkedConsentPurpose("toString")).toBe(false);
  });

  it("says which consent documents' text a policy page is, so only the CMS publishes them", () => {
    expect(isMirroredConsentPurpose("privacy_notice")).toBe(true);
    expect(isMirroredConsentPurpose("terms")).toBe(true);
    expect(isMirroredConsentPurpose("messages")).toBe(false);
    expect(isMirroredConsentPurpose("legal_privacy")).toBe(false);
  });
});

describe("cache tags", () => {
  it("gives each document its own tag", () => {
    expect(cmsTag("about")).toBe("cms:about");
    expect(new Set(CMS_DOCUMENT_KEYS.map(cmsTag)).size).toBe(
      CMS_DOCUMENT_KEYS.length
    );
  });

  it("refreshes the document's tag on publish, and the facts tag for facts", () => {
    expect(tagsToRefresh("legal_terms")).toEqual(["cms:legal_terms"]);
    expect(tagsToRefresh("site_facts")).toEqual([
      "cms:site_facts",
      ORG_FACTS_TAG,
    ]);
  });
});
