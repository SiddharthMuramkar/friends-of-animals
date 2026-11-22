import { describe, expect, it } from "vitest";

import { factsKind, type SiteFactsBody } from "./facts";

const filled: SiteFactsBody = {
  email: "hello@friendsofanimals.example",
  phone: "+91 80 1234 5678",
  address: "12 Example Road, Bengaluru 560001",
  socials: ["https://www.instagram.com/example"],
  grievanceOfficer: {
    name: "A. Example",
    email: "grievance@friendsofanimals.example",
  },
};

function refused(value: unknown): string[] {
  const result = factsKind.parse(value);
  if (result.ok) throw new Error("expected the body to be refused");
  return result.issues;
}

describe("facts kind (site facts)", () => {
  it("seeds every fact empty, so previews show placeholders as today", () => {
    expect(factsKind.seedBody()).toEqual({
      email: "",
      phone: "",
      address: "",
      socials: [],
      grievanceOfficer: { name: "", email: "" },
    });
    expect(factsKind.parse(factsKind.seedBody()).ok).toBe(true);
  });

  it("accepts FOA's confirmed facts", () => {
    expect(factsKind.parse(filled)).toEqual({ ok: true, body: filled });
  });

  it("trims and strips markup", () => {
    const result = factsKind.parse({
      ...filled,
      email: "  hello@friendsofanimals.example ",
      address: "12 <b>Example</b> Road",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body.email).toBe("hello@friendsofanimals.example");
    expect(result.body.address).toBe("12 Example Road");
  });

  it.each([
    ["email", { email: "not an address" }],
    ["grievanceOfficer.email", { grievanceOfficer: { name: "", email: "x@" } }],
    ["phone", { phone: "call us" }],
    ["socials.0", { socials: ["javascript:alert(1)"] }],
    ["socials.0", { socials: ["http://example.com"] }],
  ])("refuses a bad %s", (path, change) => {
    const issues = refused({ ...filled, ...change });
    expect(issues.some((i) => i.startsWith(path))).toBe(true);
  });

  it("refuses the same profile twice", () => {
    const url = "https://www.instagram.com/example";
    expect(refused({ ...filled, socials: [url, url] })).toContain(
      `socials: ${url} is listed more than once`
    );
  });

  it("refuses tax facts, which are settings", () => {
    const issues = refused({ ...filled, pan: "AAAAA0000A" });
    expect(issues.length).toBeGreaterThan(0);
  });

  it("renders a stored body that no longer fits as empty facts", () => {
    expect(factsKind.sanitize({ email: 42 })).toEqual(factsKind.seedBody());
  });
});
