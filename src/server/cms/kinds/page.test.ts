import { describe, expect, it } from "vitest";

import aboutMessages from "../../../../messages/en-IN/about.json";
import { pageKind } from "./page";

const seed = pageKind.seedBody();

type Fields = Record<string, unknown>;

function edit(change: (body: Record<string, Fields>) => void): unknown {
  const body = structuredClone(seed) as unknown as Record<string, Fields>;
  change(body);
  return body;
}

function refused(value: unknown): string[] {
  const result = pageKind.parse(value);
  if (result.ok) throw new Error("expected the body to be refused");
  return result.issues;
}

describe("page kind (about): the seed body", () => {
  it("passes its own schema unchanged", () => {
    expect(pageKind.parse(seed)).toEqual({ ok: true, body: seed });
  });

  it("keeps today's about page copy", () => {
    expect(seed.hero.title).toBe(
      "Kindness to animals is something children can learn"
    );
    expect(seed.how.steps.map((s) => s.title)).toEqual([
      "Children create",
      "The public sees",
      "Compassion spreads",
    ]);
    expect(seed.people.items).toHaveLength(8);
    expect(seed.objectives.items).toHaveLength(8);
    expect(seed.skill.body).toEqual([
      { p: [expect.stringMatching(/^To draw a crow well/)] },
    ]);
  });

  it("leaves only the page's labels in the about messages", () => {
    expect(Object.keys(aboutMessages.about).sort()).toEqual([
      "badges",
      "easyLabel",
      "how",
      "meta",
      "shelter",
      "transparency",
    ]);
    expect(Object.keys(aboutMessages.about.how)).toEqual(["photos"]);
    expect(Object.keys(aboutMessages.about.transparency).sort()).toEqual([
      "cta",
      "registration",
    ]);
  });
});

describe("page kind (about): what a draft may hold", () => {
  it("accepts a changed section", () => {
    const result = pageKind.parse(
      edit((b) => {
        b.ashoka.title = "Care for animals, cut into rock";
        b.objectives.items = [{ title: "Launch", body: "Open the site." }];
      })
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body.ashoka.title).toBe("Care for animals, cut into rock");
    expect(result.body.objectives.items).toEqual([
      { title: "Launch", body: "Open the site." },
    ]);
  });

  it("strips markup from text fields", () => {
    const result = pageKind.parse(
      edit((b) => (b.hero.title = "<h1 onclick=alert(1)>Kind</h1> children"))
    );
    expect(result.ok && result.body.hero.title).toBe("Kind children");
  });

  it("sends paragraphs through the rich-text sanitiser", () => {
    const result = pageKind.parse(
      edit((b) => {
        b.skill.body = [
          { p: ["Look <script>alert(1)</script>closely."] },
          { p: [{ link: "Read more", href: "javascript:alert(1)" }] },
          { p: [{ strong: "Kindness" }, " grows."] },
          { html: "<img src=x onerror=alert(1)>" },
        ];
      })
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body.skill.body).toEqual([
      { p: ["Look closely."] },
      { p: ["Read more"] },
      { p: [{ strong: "Kindness" }, " grows."] },
    ]);
  });

  it("refuses a paragraph field left with nothing in it", () => {
    const issues = refused(
      edit((b) => (b.skill.detail = [{ p: ["<script>x</script>"] }]))
    );
    expect(issues).toContain("skill.detail: write some text");
  });

  it("refuses a missing section", () => {
    const issues = refused(edit((b) => delete b.vision));
    expect(issues.some((i) => i.startsWith("vision"))).toBe(true);
  });

  it("refuses extra fields", () => {
    const issues = refused(edit((b) => (b.duty.script = "alert(1)")));
    expect(issues.some((i) => i.startsWith("duty"))).toBe(true);
  });

  it("refuses anything but three steps", () => {
    const issues = refused(
      edit((b) => {
        const steps = b.how.steps as unknown[];
        b.how.steps = steps.slice(0, 2);
      })
    );
    expect(issues.some((i) => i.startsWith("how.steps"))).toBe(true);
  });

  it("refuses an empty list of people", () => {
    const issues = refused(edit((b) => (b.people.items = [])));
    expect(issues.some((i) => i.startsWith("people.items"))).toBe(true);
  });

  it("refuses an empty heading", () => {
    const issues = refused(edit((b) => (b.duty.title = "   ")));
    expect(issues).toContain("duty.title: write some text");
  });
});

describe("page kind (about): rendering a stored body", () => {
  it("sanitises again", () => {
    const stored = edit(
      (b) => (b.skill.detail = [{ p: ['NEP <a href="x">2020</a>'] }])
    );
    expect(pageKind.sanitize(stored).skill.detail).toEqual([
      { p: ["NEP 2020"] },
    ]);
  });

  it("falls back to the seed body when the stored one no longer fits", () => {
    expect(pageKind.sanitize({})).toEqual(seed);
  });
});
