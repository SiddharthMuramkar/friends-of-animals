import { describe, expect, it } from "vitest";

import { CONTACT_FIELD_LIMITS, MIN_FILL_MS } from "./limits";
import {
  CONTACT_RATE_LIMITS,
  CONTACT_REFERENCE_PATTERN,
  contactRateRules,
  contactReferenceFormat,
  parseContactSubmission,
  screenSubmission,
} from "./submission";

const VALID = {
  topic: "SCHOOLS",
  name: "  Asha Rao ",
  email: " Asha.Rao@Example.TEST ",
  organisation: "Sunrise Public School",
  subject: "A competition at our school",
  message: "We are a school in Pune and would like to take part.",
};

describe("parsing a contact form submission", () => {
  it("trims the fields and normalises the email address", () => {
    expect(parseContactSubmission(VALID)).toEqual({
      ok: true,
      value: {
        topic: "SCHOOLS",
        name: "Asha Rao",
        email: "asha.rao@example.test",
        organisation: "Sunrise Public School",
        subject: "A competition at our school",
        message: "We are a school in Pune and would like to take part.",
      },
    });
  });

  it("stores no organisation when it is left blank or missing", () => {
    const blank = parseContactSubmission({ ...VALID, organisation: "   " });
    expect(blank.ok && blank.value.organisation).toBeNull();
    const { organisation: _omitted, ...withoutOrganisation } = VALID;
    const missing = parseContactSubmission(withoutOrganisation);
    expect(missing.ok && missing.value.organisation).toBeNull();
  });

  it("refuses a topic the page doesn't offer, safeguarding included", () => {
    for (const topic of ["SAFEGUARDING", "general", "", undefined]) {
      const result = parseContactSubmission({ ...VALID, topic });
      expect(result.ok).toBe(false);
      expect(!result.ok && result.fields).toContain("topic");
    }
  });

  it("refuses an address that isn't an email address", () => {
    const result = parseContactSubmission({ ...VALID, email: "asha@" });
    expect(result).toEqual({ ok: false, fields: ["email"] });
  });

  it.each(["name", "subject", "message"] as const)(
    "needs a %s that isn't blank",
    (field) => {
      expect(parseContactSubmission({ ...VALID, [field]: "  \n " })).toEqual({
        ok: false,
        fields: [field],
      });
    }
  );

  it.each(["name", "organisation", "subject", "message"] as const)(
    "caps %s at its limit",
    (field) => {
      const limit = CONTACT_FIELD_LIMITS[field];
      expect(
        parseContactSubmission({ ...VALID, [field]: "a".repeat(limit) }).ok
      ).toBe(true);
      expect(
        parseContactSubmission({ ...VALID, [field]: "a".repeat(limit + 1) })
      ).toEqual({ ok: false, fields: [field] });
    }
  );

  it("has the limits FOA's form shows", () => {
    expect(CONTACT_FIELD_LIMITS).toEqual({
      name: 100,
      email: 254,
      organisation: 150,
      subject: 150,
      message: 5000,
    });
  });

  it("names every field that is wrong, once each", () => {
    const result = parseContactSubmission({ topic: "NOPE", email: 4 });
    expect(result.ok).toBe(false);
    expect(!result.ok && [...result.fields].sort()).toEqual([
      "email",
      "message",
      "name",
      "subject",
      "topic",
    ]);
  });

  it("ignores fields it doesn't know", () => {
    const result = parseContactSubmission({ ...VALID, phone: "9876543210" });
    expect(result.ok && "phone" in result.value).toBe(false);
  });

  it("refuses something that isn't a form at all", () => {
    expect(parseContactSubmission(null).ok).toBe(false);
    expect(parseContactSubmission("hello").ok).toBe(false);
  });
});

describe("screening out bots", () => {
  const startedAt = new Date("2027-01-15T04:30:00.000Z");
  const after = (ms: number) => new Date(startedAt.getTime() + ms);

  it("accepts a person who took a few seconds and left the trap empty", () => {
    expect(
      screenSubmission({ honeypot: "", startedAt, now: after(MIN_FILL_MS) })
    ).toBe("accept");
    expect(
      screenSubmission({ honeypot: undefined, startedAt, now: after(60_000) })
    ).toBe("accept");
  });

  it("drops a submission that filled the hidden field", () => {
    expect(
      screenSubmission({
        honeypot: "https://spam.example",
        startedAt,
        now: after(60_000),
      })
    ).toBe("drop");
  });

  it("drops a submission faster than a person can type", () => {
    expect(MIN_FILL_MS).toBe(3000);
    expect(
      screenSubmission({ honeypot: "", startedAt, now: after(MIN_FILL_MS - 1) })
    ).toBe("drop");
    expect(screenSubmission({ honeypot: "", startedAt, now: after(-5) })).toBe(
      "drop"
    );
  });

  it("takes another minimum when given one", () => {
    expect(
      screenSubmission({
        honeypot: "",
        startedAt,
        now: after(5000),
        minFillMs: 10_000,
      })
    ).toBe("drop");
  });
});

describe("limits per IP and per email address", () => {
  it("allows 5 an hour from one IP and 5 a day from one address", () => {
    expect(CONTACT_RATE_LIMITS).toEqual({ perIpPerHour: 5, perEmailPerDay: 5 });
    expect(
      contactRateRules({ ip: "203.0.113.10", email: "asha@example.test" })
    ).toEqual([
      { scope: "ip", key: "203.0.113.10", max: 5, windowMs: 3_600_000 },
      {
        scope: "email",
        key: "asha@example.test",
        max: 5,
        windowMs: 86_400_000,
      },
    ]);
  });

  it("follows other limits when given them", () => {
    const rules = contactRateRules(
      { ip: "203.0.113.10", email: "asha@example.test" },
      { perIpPerHour: 2, perEmailPerDay: 3 }
    );
    expect(rules.map((rule) => rule.max)).toEqual([2, 3]);
  });
});

describe("contact references", () => {
  it("uses the IST year the message arrived in", () => {
    expect(contactReferenceFormat(new Date("2027-01-15T04:30:00Z"))).toEqual({
      prefix: "CM-27-",
      length: 6,
    });
    // 31 Dec 2026 19:00 UTC is already 1 Jan 2027 in India.
    expect(
      contactReferenceFormat(new Date("2026-12-31T19:00:00Z")).prefix
    ).toBe("CM-27-");
    expect(
      contactReferenceFormat(new Date("2026-12-31T18:29:59Z")).prefix
    ).toBe("CM-26-");
  });

  it("matches the reference pattern with Crockford symbols", () => {
    expect(CONTACT_REFERENCE_PATTERN.test("CM-27-8H3TZ0")).toBe(true);
    expect(CONTACT_REFERENCE_PATTERN.test("CM-27-8H3TZI")).toBe(false);
    expect(CONTACT_REFERENCE_PATTERN.test("CM-27-8H3TZ")).toBe(false);
    expect(CONTACT_REFERENCE_PATTERN.test("CM-2027-8H3TZ0")).toBe(false);
  });
});
