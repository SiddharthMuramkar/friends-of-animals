import { describe, expect, it } from "vitest";

import {
  auditHref,
  fieldsAtFault,
  readAuditFilters,
  searchInput,
} from "./filters";

const ASHA = "01938a00-0000-7000-8000-000000000101";
const CURSOR = "019a4c2e-7f00-7000-8000-00000000abcd";

describe("readAuditFilters", () => {
  it("reads the person, entity type, action and page", () => {
    expect(
      readAuditFilters({
        person: ASHA,
        entityType: "user",
        action: "role.granted",
        cursor: CURSOR,
      })
    ).toEqual({
      person: ASHA,
      entityType: "user",
      action: "role.granted",
      cursor: CURSOR,
    });
  });

  it("trims what was typed and leaves out empty fields", () => {
    // An empty GET form still sends every field.
    expect(
      readAuditFilters({
        person: "",
        entityType: "  user ",
        action: "   ",
        cursor: undefined,
      })
    ).toEqual({ entityType: "user" });
  });

  it("takes the first of a repeated param and ignores unknown ones", () => {
    expect(
      readAuditFilters({ action: ["role.revoked", "role.granted"], page: "2" })
    ).toEqual({ action: "role.revoked" });
  });
});

describe("auditHref", () => {
  it("is the bare page without filters", () => {
    expect(auditHref({})).toBe("/admin/audit");
  });

  it("keeps every filter, so older pages stay filtered", () => {
    expect(
      auditHref({ person: ASHA, action: "role.granted", cursor: CURSOR })
    ).toBe(`/admin/audit?person=${ASHA}&action=role.granted&cursor=${CURSOR}`);
  });

  it("round-trips through readAuditFilters", () => {
    const filters = {
      person: ASHA,
      entityType: "user",
      action: "role.revoked",
      cursor: CURSOR,
    };
    const url = new URL(auditHref(filters), "https://example.test");
    expect(readAuditFilters(Object.fromEntries(url.searchParams))).toEqual(
      filters
    );
  });
});

describe("fieldsAtFault", () => {
  it("names the form fields the search refused", () => {
    expect(fieldsAtFault(["person", "action"])).toEqual({
      fields: ["person", "action"],
      badPage: false,
    });
  });

  it("calls a broken page link out separately from the form", () => {
    // The cursor comes from the page's own link, never from the form.
    expect(fieldsAtFault(["cursor", "entityType"])).toEqual({
      fields: ["entityType"],
      badPage: true,
    });
  });
});

describe("the page size", () => {
  it("is read and kept across pages like a filter", () => {
    const filters = readAuditFilters({ person: ASHA, limit: "1" });
    expect(filters).toEqual({ person: ASHA, limit: "1" });
    expect(auditHref({ ...filters, cursor: CURSOR })).toBe(
      `/admin/audit?person=${ASHA}&cursor=${CURSOR}&limit=1`
    );
  });

  it("goes to the search as a number", () => {
    expect(searchInput({ action: "role.granted", limit: "20" })).toEqual({
      action: "role.granted",
      limit: 20,
    });
    expect(searchInput({ action: "role.granted" })).toEqual({
      action: "role.granted",
    });
  });

  it("goes as not-a-number when it isn't one, for the search to refuse", () => {
    expect(searchInput({ limit: "lots" }).limit).toBeNaN();
  });

  it("counts as a broken page link when the search refuses it", () => {
    expect(fieldsAtFault(["limit"])).toEqual({ fields: [], badPage: true });
  });
});
