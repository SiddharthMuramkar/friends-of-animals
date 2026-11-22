import { describe, expect, it } from "vitest";

import { createHarness, type Harness } from "@/test/harness";

import { pageKind, type AboutPageBody } from "./kinds/page";

const global = { type: "global" } as const;

async function contentManager(h: Harness) {
  const account = await h.seed.member({ name: "Chitra Content" });
  await h.seed.grant(account, { role: "content_manager", scope: global });
  return h.signIn(account);
}

function editedAbout(change: (body: AboutPageBody) => void): AboutPageBody {
  const body = pageKind.seedBody();
  change(body);
  return body;
}

describe("the about page document", () => {
  it("publishes a changed section", async () => {
    const h = await createHarness();
    const actor = await contentManager(h);
    const body = editedAbout((b) => {
      b.ashoka.title = "Care for animals, cut into rock";
    });

    const saved = await h.as(actor).saveDraft({ key: "about", body });
    if (!saved.ok) throw new Error(JSON.stringify(saved));
    await h.as(actor).publishRevision({ revisionId: saved.revisionId });

    const read = await h.as(h.visitor()).getPublishedDocument({ key: "about" });
    expect(pageKind.sanitize(read?.body).ashoka.title).toBe(
      "Care for animals, cut into rock"
    );
  });

  it("sends its paragraphs through the rich-text sanitiser", async () => {
    const h = await createHarness();
    const actor = await contentManager(h);
    const body = editedAbout((b) => {
      (b.skill as { body: unknown }).body = [
        { p: ["Look <script>alert(1)</script>closely."] },
        { p: [{ link: "Read more", href: "javascript:alert(1)" }] },
        { p: ["<img src=x onerror=alert(1)>"] },
      ];
    });

    const saved = await h.as(actor).saveDraft({ key: "about", body });
    if (!saved.ok) throw new Error(JSON.stringify(saved));
    const draft = await h.as(actor).getDraftForPreview({ key: "about" });

    expect(pageKind.sanitize(draft?.body).skill.body).toEqual([
      { p: ["Look closely."] },
      { p: ["Read more"] },
    ]);
  });

  it("refuses a body missing a section", async () => {
    const h = await createHarness();
    const actor = await contentManager(h);
    const { vision: _, ...withoutVision } = pageKind.seedBody();

    const saved = await h
      .as(actor)
      .saveDraft({ key: "about", body: withoutVision });

    expect(saved).toMatchObject({ ok: false, error: "invalid_body" });
  });

  it("is seeded once as version 1 with today's about page", async () => {
    const h = await createHarness();

    await h.seed.preview();
    await h.seed.preview();

    const read = await h.as(h.visitor()).getPublishedDocument({ key: "about" });
    expect(read).toMatchObject({ version: 1, body: pageKind.seedBody() });
  });
});
