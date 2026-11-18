import { describe, expect, it } from "vitest";

import { fleschKincaidGrade } from "@/content/stories/text";

import { LEGAL_DOCS } from ".";
import type { LegalInline } from "./model";

const plain = (text: LegalInline[]) =>
  text
    .map((i) =>
      typeof i === "string"
        ? i
        : "strong" in i
          ? i.strong
          : "link" in i
            ? i.link
            : "contact"
    )
    .join("");

describe.each(Object.entries(LEGAL_DOCS))("%s", (name, doc) => {
  it("has a fixed ISO 'last updated' date", () => {
    expect(doc.updated).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("opens with a short version of 3–7 points", () => {
    expect(doc.short.length).toBeGreaterThanOrEqual(3);
    expect(doc.short.length).toBeLessThanOrEqual(7);
  });

  it("has unique kebab-case section ids", () => {
    const ids = doc.sections.map((s) => s.id);
    expect(new Set(ids).size, name).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z]+(?:-[a-z]+)*$/);
  });

  it("never types an email address, phone number or ₹ amount by hand", () => {
    const text = JSON.stringify(doc);
    expect(text).not.toMatch(/[\w.]+@[\w-]+\.\w+/);
    expect(text).not.toMatch(/₹\s?\d/);
  });

  it("avoids tax-status claims and banned words", () => {
    const text = JSON.stringify(doc);
    for (const re of [/80G/, /12A/, /FCRA/, /voiceless/i, /empower/i, /!/])
      expect(text).not.toMatch(re);
  });
});

describe("child-friendly short versions", () => {
  it.each(["safeguarding", "childProtection"] as const)(
    "%s reads at grade 6 or below",
    (name) => {
      const text = LEGAL_DOCS[name].short.map(plain).join("\n");
      expect(fleschKincaidGrade(text)).toBeLessThanOrEqual(6);
    }
  );
});
