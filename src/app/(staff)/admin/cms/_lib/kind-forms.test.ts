import { describe, expect, it } from "vitest";

import type { CmsDocumentKind } from "@/server/modules/cms/domain/documents";
import { kindOf } from "@/server/modules/cms/kinds";
import { factsKind } from "@/server/modules/cms/kinds/facts";
import { homeKind } from "@/server/modules/cms/kinds/home";
import { impactKind } from "@/server/modules/cms/kinds/impact";
import { pageKind } from "@/server/modules/cms/kinds/page";

import {
  bodyFrom,
  type FormValues,
  issuesByField,
  kindForm,
  type KindForm,
  valuesOf,
} from "./kind-forms";

const KEY_OF = {
  home: "home",
  page: "about",
  impact: "impact",
  facts: "site_facts",
} as const;

function formOf(kind: CmsDocumentKind): KindForm {
  const form = kindForm(kind);
  if (!form) throw new Error(`${kind} has no form`);
  return form;
}

/** Submits `values` as the browser would: unticked boxes are absent. */
function submit(form: KindForm, values: FormValues) {
  return bodyFrom(
    form,
    (name) => {
      const value = values[name];
      return typeof value === "string" ? value : "";
    },
    (name) => values[name] === true
  );
}

describe("each kind's form", () => {
  it.each(["home", "page", "impact", "facts"] as const)(
    "gives back the %s seed body unchanged when submitted as filled",
    (kind) => {
      const cmsKind = kindOf(KEY_OF[kind])!;
      const seed = cmsKind.seedBody(KEY_OF[kind]);
      const form = formOf(kind);

      const read = submit(form, valuesOf(form, seed));

      expect(read.ok).toBe(true);
      if (!read.ok) return;
      expect(cmsKind.parse(read.body)).toEqual({ ok: true, body: seed });
    }
  );

  it("has no form for a policy page, which keeps #64's markup", () => {
    expect(kindForm("legal")).toBeNull();
  });
});

describe("the home form", () => {
  const form = formOf("home");

  it("hides a section when its box is unticked, keeping the order", () => {
    const values = valuesOf(form, homeKind.seedBody());
    values["sections.seasonal"] = false;

    const read = submit(form, values);

    if (!read.ok) throw new Error("not read");
    const parsed = homeKind.parse(read.body);
    if (!parsed.ok) throw new Error(parsed.issues.join("; "));
    expect(parsed.body.sections.map((s) => s.key)).toEqual(
      homeKind.seedBody().sections.map((s) => s.key)
    );
    expect(
      parsed.body.sections.find((s) => s.key === "seasonal")?.visible
    ).toBe(false);
  });

  it("leaves the second button out when both its fields are empty", () => {
    const values = valuesOf(form, homeKind.seedBody());
    values["hero.secondaryCta.label"] = "";
    values["hero.secondaryCta.href"] = "";

    const read = submit(form, values);

    if (!read.ok) throw new Error("not read");
    const parsed = homeKind.parse(read.body);
    expect(parsed.ok && parsed.body.hero.secondaryCta).toBeUndefined();
  });

  it("puts each refusal beside its field", () => {
    const values = valuesOf(form, homeKind.seedBody());
    values["hero.heading"] = "<b></b>";
    values["counterKeys.1"] = values["counterKeys.0"] as string;

    const read = submit(form, values);
    if (!read.ok) throw new Error("not read");
    const parsed = homeKind.parse(read.body);
    if (parsed.ok) throw new Error("accepted");

    const byField = issuesByField(form, parsed.issues);
    expect(byField["hero.heading"]).toEqual(["write some text"]);
    expect(Object.keys(byField)).toContain("counterKeys.0");
  });
});

describe("the impact form", () => {
  const form = formOf("impact");

  it("leaves out a counter left empty, and keeps the others' order", () => {
    const values = valuesOf(form, impactKind.seedBody());
    values["counters.institutions"] = "";
    values["counters.certificatesIssued"] = "120";
    values.asOf = "2026-12-01";

    const read = submit(form, values);

    if (!read.ok) throw new Error("not read");
    expect(impactKind.parse(read.body)).toEqual({
      ok: true,
      body: {
        asOf: "2026-12-01",
        counters: [
          { key: "participants", value: 1249 },
          { key: "statesReached", value: 12 },
          { key: "competitions", value: 3 },
          { key: "certificatesIssued", value: 120 },
        ],
      },
    });
  });

  it.each(["-3", "2.5", "lots"])("refuses %j as a count", (entered) => {
    const values = valuesOf(form, impactKind.seedBody());
    values["counters.participants"] = entered;

    expect(submit(form, values)).toEqual({
      ok: false,
      problems: { "counters.participants": { kind: "count" } },
    });
  });
});

describe("the about form", () => {
  const form = formOf("page");

  it("reads paragraphs, a list and a link from the markup", () => {
    const values = valuesOf(form, pageKind.seedBody());
    values["skill.body"] =
      "Watch the crow.\n\n- Look closely\n- Draw [what you see](/competitions)";

    const read = submit(form, values);

    if (!read.ok) throw new Error("not read");
    const parsed = pageKind.parse(read.body);
    expect(parsed.ok && parsed.body.skill.body).toEqual([
      { p: ["Watch the crow."] },
      {
        list: [
          ["Look closely"],
          ["Draw ", { link: "what you see", href: "/competitions" }],
        ],
      },
    ]);
  });

  it("names the markup's line errors by the field's own lines", () => {
    const values = valuesOf(form, pageKind.seedBody());
    values["skill.detail"] = "Fine line.\n\nA **bold start";

    const read = submit(form, values);

    expect(read).toEqual({
      ok: false,
      problems: {
        "skill.detail": {
          kind: "markup",
          errors: [{ line: 3, code: "unclosed_strong" }],
        },
      },
    });
  });

  it("reads objectives as a title line and a body, a blank line apart", () => {
    const values = valuesOf(form, pageKind.seedBody());
    values["objectives.items"] =
      "Kindness\nTo every animal.\n\nCare\nEvery day.";

    const read = submit(form, values);

    if (!read.ok) throw new Error("not read");
    const parsed = pageKind.parse(read.body);
    expect(parsed.ok && parsed.body.objectives.items).toEqual([
      { title: "Kindness", body: "To every animal." },
      { title: "Care", body: "Every day." },
    ]);
  });
});

describe("the site facts form", () => {
  it("reads one social profile per line", () => {
    const form = formOf("facts");
    const values = valuesOf(form, factsKind.seedBody());
    values.socials =
      "https://www.instagram.com/foa\n\n  https://www.youtube.com/@foa  ";
    values.email = "hello@friendsofanimals.example";

    const read = submit(form, values);

    if (!read.ok) throw new Error("not read");
    const parsed = factsKind.parse(read.body);
    expect(parsed.ok && parsed.body).toMatchObject({
      email: "hello@friendsofanimals.example",
      socials: [
        "https://www.instagram.com/foa",
        "https://www.youtube.com/@foa",
      ],
    });
  });
});
