import { describe, expect, it } from "vitest";

import type { Role } from "@/server/access/domain/roles";
import type { Actor } from "@/server/actor";
import { cmsDocument, cmsRevision } from "@/server/db/schema";
import { createHarness, type Harness } from "@/test/harness";

const global = { type: "global" } as const;

/** The usual stored-XSS payloads, in every string a legal body has. */
const UNSAFE_BODY = {
  short: [["Read this <script>alert('short')</script>first."]],
  sections: [
    {
      id: "who-we-are<img src=x onerror=alert(1)>",
      title: "Who we are <svg onload=alert(1)></svg>",
      blocks: [
        { p: ["We run <b onmouseover=alert(1)>art</b> competitions."] },
        {
          list: [
            [{ link: "Write to us", href: "javascript:alert(1)" }],
            [{ strong: "<iframe src=//evil.example></iframe>Safe" }],
          ],
        },
      ],
      onclick: "alert(1)",
    },
  ],
  html: "<script>alert(1)</script>",
};

const STRIPPED_BODY = {
  short: [["Read this first."]],
  sections: [
    {
      id: "who-we-are",
      title: "Who we are",
      blocks: [
        { p: ["We run art competitions."] },
        { list: [["Write to us"], [{ strong: "Safe" }]] },
      ],
    },
  ],
};

function legalBody(paragraph: string) {
  return {
    short: [["We keep children safe."]],
    sections: [
      {
        id: "how-to-report",
        title: "How to report",
        blocks: [{ p: [paragraph] }],
      },
    ],
  };
}

async function contentManager(h: Harness) {
  const account = await h.seed.member({ name: "Chitra Content" });
  await h.seed.grant(account, { role: "content_manager", scope: global });
  return h.signIn(account);
}

async function holding(h: Harness, ...roles: Role[]) {
  const account = await h.seed.member();
  for (const role of roles)
    await h.seed.grant(account, { role, scope: global });
  return h.signIn(account);
}

async function publish(h: Harness, actor: Actor, body: unknown) {
  const saved = await h
    .as(actor)
    .saveDraft({ key: "legal_safeguarding", body });
  if (!saved.ok) throw new Error(`Could not save: ${JSON.stringify(saved)}`);
  const published = await h.as(actor).publishRevision({
    revisionId: saved.revisionId,
  });
  if (!published.ok) throw new Error("Could not publish");
  return saved.revisionId;
}

describe("getPublishedDocument", () => {
  it("strips unsafe markup from a stored revision when it renders it", async () => {
    const h = await createHarness();
    const now = h.clock.now();
    // Written straight to the table, as a bad import or an old row would be.
    await h.db.insert(cmsDocument).values({
      id: "01938a00-0000-7000-8000-000000000d01",
      key: "legal_terms",
      kind: "legal",
      createdAt: now,
    });
    await h.db.insert(cmsRevision).values({
      id: "01938a00-0000-7000-8000-000000000e01",
      documentId: "01938a00-0000-7000-8000-000000000d01",
      version: 1,
      body: UNSAFE_BODY,
      status: "published",
      createdAt: now,
      updatedAt: now,
      publishedAt: now,
    });

    expect(
      await h.as(h.visitor()).getPublishedDocument({ key: "legal_terms" })
    ).toEqual({
      key: "legal_terms",
      version: 1,
      publishedAt: now,
      body: STRIPPED_BODY,
    });
  });

  it("is null until a version is published", async () => {
    const h = await createHarness();
    const manager = await contentManager(h);
    await h.as(manager).saveDraft({
      key: "legal_safeguarding",
      body: legalBody("A draft."),
    });

    expect(
      await h.as(h.visitor()).getPublishedDocument({
        key: "legal_safeguarding",
      })
    ).toBeNull();
  });

  it("is anyone's to read, signed in or not", async () => {
    const h = await createHarness();
    const manager = await contentManager(h);
    await publish(h, manager, legalBody("Public words."));
    const member = await holding(h);

    for (const actor of [h.visitor(), member, manager]) {
      expect(
        await h.as(actor).getPublishedDocument({ key: "legal_safeguarding" })
      ).toMatchObject({ version: 1, body: legalBody("Public words.") });
    }
  });
});

describe("previewing a draft", () => {
  it("shows the draft to a content manager while visitors still get the published text", async () => {
    const h = await createHarness();
    const manager = await contentManager(h);
    await publish(h, manager, legalBody("Published words."));
    const draft = await h.as(manager).saveDraft({
      key: "legal_safeguarding",
      body: legalBody("Draft words."),
    });
    if (!draft.ok) throw new Error("not saved");

    expect(
      await h.as(h.visitor()).getPublishedDocument({
        key: "legal_safeguarding",
      })
    ).toMatchObject({ version: 1, body: legalBody("Published words.") });
    expect(
      await h.as(manager).getDraftForPreview({ key: "legal_safeguarding" })
    ).toEqual({
      revisionId: draft.revisionId,
      updatedAt: h.clock.now(),
      body: legalBody("Draft words."),
    });
  });

  it("is null when the document has no open draft", async () => {
    const h = await createHarness();
    const manager = await contentManager(h);
    await publish(h, manager, legalBody("Published words."));

    expect(
      await h.as(manager).getDraftForPreview({ key: "legal_safeguarding" })
    ).toBeNull();
  });

  it("starts preview mode for a content manager, on the document's public page", async () => {
    const h = await createHarness();
    const manager = await contentManager(h);

    expect(
      await h.as(manager).startPreview({ key: "legal_safeguarding" })
    ).toEqual({ ok: true, path: "/safeguarding" });
    expect(await h.as(manager).startPreview({ key: "legal_privacy" })).toEqual({
      ok: true,
      path: "/privacy",
    });
    expect(
      await h.as(manager).startPreview({ key: "legal_child_protection" })
    ).toEqual({ ok: true, path: "/child-protection-policy" });
  });

  const REFUSED: { who: string; roles: Role[] }[] = [
    { who: "a member", roles: [] },
    { who: "a competition manager", roles: ["competition_manager"] },
    { who: "a staff admin", roles: ["staff_admin"] },
  ];

  for (const { who, roles } of REFUSED) {
    it(`refuses ${who} the draft and preview mode`, async () => {
      const h = await createHarness();
      const manager = await contentManager(h);
      await h.as(manager).saveDraft({
        key: "legal_safeguarding",
        body: legalBody("Draft words."),
      });
      const actor = await holding(h, ...roles);

      await expect(
        h.as(actor).getDraftForPreview({ key: "legal_safeguarding" })
      ).rejects.toMatchObject({ code: "forbidden" });
      await expect(
        h.as(actor).startPreview({ key: "legal_safeguarding" })
      ).rejects.toMatchObject({ code: "forbidden" });
    });
  }

  it("refuses a visitor, and a content manager without a second factor", async () => {
    const h = await createHarness();
    const account = await h.seed.member();
    await h.seed.grant(account, { role: "content_manager", scope: global });
    await h.seed.authenticator(account);
    const unverified = await h.signIn(account, undefined, {
      secondFactor: false,
    });

    await expect(
      h.as(h.visitor()).getDraftForPreview({ key: "legal_safeguarding" })
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      h.as(h.visitor()).startPreview({ key: "legal_safeguarding" })
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      h.as(unverified).getDraftForPreview({ key: "legal_safeguarding" })
    ).rejects.toMatchObject({ code: "second_factor_required" });
    await expect(
      h.as(unverified).startPreview({ key: "legal_safeguarding" })
    ).rejects.toMatchObject({ code: "second_factor_required" });
  });
});
