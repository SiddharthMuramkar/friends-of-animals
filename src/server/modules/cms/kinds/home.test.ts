import { describe, expect, it } from "vitest";

import homeMessages from "../../../../../messages/en-IN/home.json";
import { visibleSections } from "../../../../app/_components/home-layout";
import { CTA_PATHS, HOME_SECTION_KEYS, homeKind, type HomeBody } from "./home";

const seed = homeKind.seedBody();

function edit(change: (body: Record<string, unknown>) => void): unknown {
  const body = structuredClone(seed) as unknown as Record<string, unknown>;
  change(body);
  return body;
}

function hero(body: Record<string, unknown>): Record<string, unknown> {
  return body.hero as Record<string, unknown>;
}

function refused(value: unknown): string[] {
  const result = homeKind.parse(value);
  if (result.ok) throw new Error("expected the body to be refused");
  return result.issues;
}

describe("home kind: the seed body", () => {
  it("passes its own schema unchanged", () => {
    expect(homeKind.parse(seed)).toEqual({ ok: true, body: seed });
  });

  it("is a fresh copy each time", () => {
    const first = homeKind.seedBody();
    first.hero.heading = "Changed";
    expect(homeKind.seedBody().hero.heading).not.toBe("Changed");
  });

  it("lists every section once, in today's order, with events hidden", () => {
    expect(seed.sections.map((s) => s.key)).toEqual([...HOME_SECTION_KEYS]);
    expect(visibleSections(seed)).not.toContain("events");
    expect(visibleSections(seed)).toHaveLength(HOME_SECTION_KEYS.length - 1);
  });

  it("keeps the home page's hero copy and buttons", () => {
    expect(seed.hero).toMatchObject({
      heading: "Children’s art that grows kindness to animals",
      imageAssetId: "dog-bengaluru-auto-rickshaw",
      primaryCta: { href: "/competitions" },
      secondaryCta: { href: "/schools" },
    });
    expect(seed.counterKeys).toEqual([
      "participants",
      "institutions",
      "statesReached",
      "competitions",
    ]);
  });

  it("holds the hero copy that left the home messages", () => {
    expect(Object.keys(homeMessages.home)).not.toContain("hero");
  });
});

describe("home kind: what a draft may hold", () => {
  it("accepts a changed heading and a hidden section", () => {
    const body = edit((b) => {
      hero(b).heading = "Kindness starts on your street";
      b.sections = seed.sections.map((s) =>
        s.key === "seasonal" ? { ...s, visible: false } : s
      );
    });
    const result = homeKind.parse(body);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body.hero.heading).toBe("Kindness starts on your street");
    expect(visibleSections(result.body)).not.toContain("seasonal");
  });

  it("accepts sections in a new order and keeps that order", () => {
    const sections = [...seed.sections].reverse();
    const result = homeKind.parse(edit((b) => (b.sections = sections)));
    expect(result.ok && result.body.sections).toEqual(sections);
  });

  it("accepts no second button", () => {
    const result = homeKind.parse(edit((b) => delete hero(b).secondaryCta));
    expect(result.ok && result.body.hero.secondaryCta).toBeUndefined();
  });

  it("refuses an unknown section", () => {
    const issues = refused(
      edit((b) => {
        b.sections = [...seed.sections, { key: "raffle", visible: true }];
      })
    );
    expect(issues.join("\n")).toMatch(/^sections\.11\.key: /m);
  });

  it("refuses a section listed twice", () => {
    const issues = refused(
      edit((b) => {
        b.sections = [...seed.sections, { key: "gallery", visible: false }];
      })
    );
    expect(issues).toContain("sections: gallery is listed more than once");
  });

  it("refuses a missing section", () => {
    const issues = refused(
      edit((b) => (b.sections = seed.sections.filter((s) => s.key !== "joy")))
    );
    expect(issues).toContain("sections: joy is missing");
  });

  it.each([
    ["three keys", ["participants", "institutions", "competitions"]],
    [
      "a repeated key",
      ["participants", "participants", "institutions", "competitions"],
    ],
    [
      "funds raised, which is computed",
      ["participants", "institutions", "competitions", "fundsRaised"],
    ],
  ])("refuses counter keys with %s", (_, counterKeys) => {
    const issues = refused(edit((b) => (b.counterKeys = counterKeys)));
    expect(issues.some((i) => i.startsWith("counterKeys"))).toBe(true);
  });

  it.each([
    "https://example.com",
    "javascript:alert(1)",
    "/competitions/[slug]",
    "/styleguide",
    "/nowhere",
  ])("refuses a button to %s", (href) => {
    const issues = refused(
      edit((b) => (hero(b).primaryCta = { label: "Go", href }))
    );
    expect(issues.some((i) => i.startsWith("hero.primaryCta.href"))).toBe(true);
  });

  it("offers buttons to public pages only", () => {
    expect(CTA_PATHS).toContain("/donate");
    expect(CTA_PATHS).not.toContain("/styleguide");
    expect(CTA_PATHS.every((path) => !path.includes("["))).toBe(true);
  });

  it("refuses a picture that is not a site image", () => {
    const issues = refused(
      edit((b) => (hero(b).imageAssetId = "https://example.com/cat.jpg"))
    );
    expect(issues.some((i) => i.startsWith("hero.imageAssetId"))).toBe(true);
  });

  it("refuses extra fields", () => {
    const issues = refused(edit((b) => (hero(b).html = "<b>hi</b>")));
    expect(issues.some((i) => i.startsWith("hero"))).toBe(true);
  });

  it("strips markup from the hero and button text", () => {
    const result = homeKind.parse(
      edit((b) => {
        hero(b).heading = "Kind <script>alert(1)</script>streets";
        hero(b).primaryCta = {
          label: '<img src=x onerror="alert(1)">Enter',
          href: "/competitions",
        };
      })
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body.hero.heading).toBe("Kind streets");
    expect(result.body.hero.primaryCta.label).toBe("Enter");
  });

  it("refuses a heading that is only markup", () => {
    const issues = refused(edit((b) => (hero(b).heading = "<b> </b>")));
    expect(issues.some((i) => i.startsWith("hero.heading"))).toBe(true);
  });

  it("refuses a body that is not an object", () => {
    expect(refused(null).length).toBeGreaterThan(0);
    expect(refused([]).length).toBeGreaterThan(0);
  });
});

describe("home kind: rendering a stored body", () => {
  it("strips markup again", () => {
    const stored = edit(
      (b) => (hero(b).subheading = 'Hi <b onclick="alert(1)">there</b>')
    );
    expect(homeKind.sanitize(stored).hero.subheading).toBe("Hi there");
  });

  it("falls back to the seed body when the stored one no longer fits", () => {
    const stored = edit((b) => (b.sections = []));
    expect(homeKind.sanitize(stored)).toEqual(seed);
    expect(homeKind.sanitize("not a body")).toEqual(seed);
  });

  it("types the result as a home body", () => {
    const body: HomeBody = homeKind.sanitize(seed);
    expect(body.hero.primaryCta.href).toBe("/competitions");
  });
});
