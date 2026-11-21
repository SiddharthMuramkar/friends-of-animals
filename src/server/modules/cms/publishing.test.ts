import { count, eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import type { Role } from "@/server/access/domain/roles";
import type { Actor } from "@/server/actor";
import { auditLog, cmsDocument, cmsRevision } from "@/server/db/schema";
import { createHarness, type Harness } from "@/test/harness";

const global = { type: "global" } as const;

/** A safeguarding page whose strings carry the usual stored-XSS payloads. */
const UNSAFE_BODY = {
  short: [["Stay safe <script>alert('short')</script>online."]],
  sections: [
    {
      id: "how-to-report",
      title: "How to report <svg onload=alert(1)></svg>",
      blocks: [
        { p: ["Tell us <img src=x onerror=alert(1)>at once."] },
        { p: [{ link: "Report here", href: "javascript:alert(1)" }] },
      ],
    },
  ],
};

/** What the sanitiser leaves of UNSAFE_BODY: the text, the link as text. */
const STRIPPED_BODY = {
  short: [["Stay safe online."]],
  sections: [
    {
      id: "how-to-report",
      title: "How to report",
      blocks: [{ p: ["Tell us at once."] }, { p: ["Report here"] }],
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

/** A signed-in content manager who has passed their second factor. */
async function contentManager(h: Harness) {
  const account = await h.seed.member({ name: "Chitra Content" });
  await h.seed.grant(account, { role: "content_manager", scope: global });
  return { account, actor: await h.signIn(account) };
}

/** A signed-in member holding `roles` globally (second factor passed). */
async function holding(h: Harness, ...roles: Role[]) {
  const account = await h.seed.member();
  for (const role of roles)
    await h.seed.grant(account, { role, scope: global });
  return h.signIn(account);
}

async function revisionsOf(h: Harness, key: string) {
  return h.db
    .select({
      id: cmsRevision.id,
      status: cmsRevision.status,
      version: cmsRevision.version,
      body: cmsRevision.body,
    })
    .from(cmsRevision)
    .innerJoin(cmsDocument, eq(cmsDocument.id, cmsRevision.documentId))
    .where(eq(cmsDocument.key, key))
    .orderBy(cmsRevision.createdAt, cmsRevision.id);
}

async function rowCounts(h: Harness) {
  const [revisions] = await h.db.select({ n: count() }).from(cmsRevision);
  const [entries] = await h.db.select({ n: count() }).from(auditLog);
  return { revisions: revisions?.n, auditEntries: entries?.n };
}

/** Saves `body` as the draft of `key` and publishes it. */
async function publish(
  h: Harness,
  actor: Actor,
  key: "legal_safeguarding" | "legal_child_protection",
  body: unknown
) {
  const saved = await h.as(actor).saveDraft({ key, body });
  if (!saved.ok) throw new Error(`Could not save: ${JSON.stringify(saved)}`);
  const published = await h.as(actor).publishRevision({
    revisionId: saved.revisionId,
  });
  if (!published.ok) {
    throw new Error(`Could not publish: ${JSON.stringify(published)}`);
  }
  return { revisionId: saved.revisionId, ...published };
}

describe("saveDraft", () => {
  it("strips scripts, event handlers and javascript: links before storing", async () => {
    const h = await createHarness();
    const { actor } = await contentManager(h);

    const saved = await h.as(actor).saveDraft({
      key: "legal_safeguarding",
      body: UNSAFE_BODY,
    });

    expect(saved).toEqual({ ok: true, revisionId: expect.any(String) });
    const [row, ...others] = await revisionsOf(h, "legal_safeguarding");
    expect(others).toEqual([]);
    expect(row).toMatchObject({ status: "draft", version: null });
    expect(row?.body).toEqual(STRIPPED_BODY);
    const stored = JSON.stringify(row?.body);
    for (const payload of ["<", "script", "onerror", "onload", "javascript:"]) {
      expect(stored).not.toContain(payload);
    }
  });

  it("keeps one open draft per document and edits it in place", async () => {
    const h = await createHarness();
    const { actor } = await contentManager(h);

    const first = await h.as(actor).saveDraft({
      key: "legal_safeguarding",
      body: legalBody("First words."),
    });
    h.clock.advance({ minutes: 5 });
    const second = await h.as(actor).saveDraft({
      key: "legal_safeguarding",
      body: legalBody("Second words."),
    });

    expect(second).toEqual(first);
    expect(await revisionsOf(h, "legal_safeguarding")).toEqual([
      expect.objectContaining({
        status: "draft",
        body: legalBody("Second words."),
      }),
    ]);
  });

  it("refuses a body that isn't a legal document, and stores nothing", async () => {
    const h = await createHarness();
    const { actor } = await contentManager(h);

    const saved = await h.as(actor).saveDraft({
      key: "legal_terms",
      body: { short: [], sections: [] },
    });

    expect(saved).toEqual({
      ok: false,
      error: "invalid_body",
      issues: [expect.stringContaining("sections")],
    });
    expect(await rowCounts(h)).toEqual({ revisions: 0, auditEntries: 0 });
  });

  it("refuses a document that doesn't exist", async () => {
    const h = await createHarness();
    const { actor } = await contentManager(h);

    expect(
      await h.as(actor).saveDraft({ key: "legal_cookies", body: {} } as never)
    ).toEqual({ ok: false, error: "invalid_input", fields: ["key"] });
  });
});

describe("publishRevision", () => {
  it("publishes the draft as version 1 and returns the tags to refresh", async () => {
    const h = await createHarness();
    const { actor } = await contentManager(h);
    const saved = await h.as(actor).saveDraft({
      key: "legal_safeguarding",
      body: legalBody("Version one."),
    });
    if (!saved.ok) throw new Error("not saved");

    expect(
      await h.as(actor).publishRevision({ revisionId: saved.revisionId })
    ).toEqual({ ok: true, version: 1, tags: ["cms:legal_safeguarding"] });
    expect(await revisionsOf(h, "legal_safeguarding")).toEqual([
      expect.objectContaining({ status: "published", version: 1 }),
    ]);
  });

  it("supersedes the published revision and audits each publish without the body", async () => {
    const h = await createHarness();
    const { account, actor } = await contentManager(h);
    const v1 = await publish(
      h,
      actor,
      "legal_safeguarding",
      legalBody("Version one.")
    );
    h.clock.advance({ days: 1 });

    const v2 = await publish(
      h,
      actor,
      "legal_safeguarding",
      legalBody("Version two.")
    );

    expect(v2.version).toBe(2);
    expect(await revisionsOf(h, "legal_safeguarding")).toEqual([
      expect.objectContaining({ id: v1.revisionId, status: "superseded" }),
      expect.objectContaining({
        id: v2.revisionId,
        status: "published",
        version: 2,
        body: legalBody("Version two."),
      }),
    ]);
    const entries = await h.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, "cms_revision.published"))
      .orderBy(auditLog.occurredAt);
    expect(entries).toHaveLength(2);
    expect(entries[1]).toMatchObject({
      actorUserId: account.id,
      actorRole: "content_manager",
      entityType: "cms_revision",
      entityId: v2.revisionId,
      before: {
        documentKey: "legal_safeguarding",
        revisionId: v2.revisionId,
        status: "draft",
        published: { revisionId: v1.revisionId, version: 1 },
      },
      after: {
        documentKey: "legal_safeguarding",
        revisionId: v2.revisionId,
        status: "published",
        version: 2,
      },
    });
    expect(JSON.stringify(entries)).not.toContain("Version two.");
  });

  it("counts versions per document and never reuses a number", async () => {
    const h = await createHarness();
    const { actor } = await contentManager(h);

    await publish(h, actor, "legal_safeguarding", legalBody("One."));
    await publish(h, actor, "legal_safeguarding", legalBody("Two."));
    const other = await publish(
      h,
      actor,
      "legal_child_protection",
      legalBody("One.")
    );
    const third = await publish(
      h,
      actor,
      "legal_safeguarding",
      legalBody("Three.")
    );

    expect(other.version).toBe(1);
    expect(third.version).toBe(3);
  });

  it("refuses a revision that is no longer a draft, or doesn't exist", async () => {
    const h = await createHarness();
    const { actor } = await contentManager(h);
    const { revisionId } = await publish(
      h,
      actor,
      "legal_safeguarding",
      legalBody("Once.")
    );
    const before = await rowCounts(h);

    expect(await h.as(actor).publishRevision({ revisionId })).toEqual({
      ok: false,
      error: "not_draft",
    });
    expect(
      await h.as(actor).publishRevision({
        revisionId: "01938a00-0000-7000-8000-00000000dead",
      })
    ).toEqual({ ok: false, error: "not_found" });
    expect(await rowCounts(h)).toEqual(before);
  });
});

describe("a published revision", () => {
  /** Postgres's refusal, which Drizzle keeps as the error's `cause`. */
  function refused(message: RegExp) {
    return { cause: { message: expect.stringMatching(message) } };
  }

  async function published(h: Harness) {
    const { actor } = await contentManager(h);
    const v1 = await publish(h, actor, "legal_safeguarding", legalBody("One."));
    const v2 = await publish(h, actor, "legal_safeguarding", legalBody("Two."));
    return { superseded: v1.revisionId, published: v2.revisionId };
  }

  it("can't have its body changed, even by a raw UPDATE", async () => {
    const h = await createHarness();
    const ids = await published(h);

    for (const id of [ids.published, ids.superseded]) {
      await expect(
        h.db.execute(
          sql`UPDATE cms_revision SET body = '{"short":[],"sections":[]}' WHERE id = ${id}`
        )
      ).rejects.toMatchObject(refused(/cms_revision .* can't change/));
    }
  });

  it("can't be renumbered, moved back to a draft or deleted", async () => {
    const h = await createHarness();
    const ids = await published(h);

    await expect(
      h.db.execute(
        sql`UPDATE cms_revision SET version = 9 WHERE id = ${ids.published}`
      )
    ).rejects.toMatchObject(refused(/cms_revision .* can't change/));
    await expect(
      h.db.execute(
        sql`UPDATE cms_revision SET status = 'draft', version = NULL, published_at = NULL WHERE id = ${ids.superseded}`
      )
    ).rejects.toMatchObject(refused(/cms_revision .* can't change/));
    await expect(
      h.db.execute(sql`DELETE FROM cms_revision WHERE id = ${ids.published}`)
    ).rejects.toMatchObject(refused(/cms_revision .* can't be deleted/));
  });

  it("is the only published one, and a document has only one open draft", async () => {
    const h = await createHarness();
    await published(h);
    const [document] = await h.db
      .select({ id: cmsDocument.id })
      .from(cmsDocument)
      .where(eq(cmsDocument.key, "legal_safeguarding"));
    const row = {
      documentId: document!.id,
      body: legalBody("Raw."),
      createdAt: h.clock.now(),
      updatedAt: h.clock.now(),
    };

    await expect(
      h.db.insert(cmsRevision).values({
        ...row,
        id: "01938a00-0000-7000-8000-000000000a01",
        status: "published",
        version: 7,
        publishedAt: h.clock.now(),
      })
    ).rejects.toMatchObject({
      cause: { constraint: "cms_revision_one_published" },
    });
    await h.db.insert(cmsRevision).values({
      ...row,
      id: "01938a00-0000-7000-8000-000000000a02",
      status: "draft",
    });
    await expect(
      h.db.insert(cmsRevision).values({
        ...row,
        id: "01938a00-0000-7000-8000-000000000a03",
        status: "draft",
      })
    ).rejects.toMatchObject({
      cause: { constraint: "cms_revision_one_draft" },
    });
  });
});

describe("listCmsDocuments and listRevisions", () => {
  it("lists all eight documents with their published version and open draft", async () => {
    const h = await createHarness();
    const { actor } = await contentManager(h);
    await publish(h, actor, "legal_safeguarding", legalBody("One."));
    const publishedAt = h.clock.now();
    h.clock.advance({ hours: 1 });
    await h.as(actor).saveDraft({
      key: "legal_safeguarding",
      body: legalBody("Two."),
    });
    await h.as(actor).saveDraft({ key: "legal_terms", body: legalBody("T.") });

    const documents = await h.as(actor).listCmsDocuments();

    expect(documents.map((d) => d.key)).toEqual([
      "home",
      "about",
      "impact",
      "site_facts",
      "legal_privacy",
      "legal_terms",
      "legal_safeguarding",
      "legal_child_protection",
    ]);
    expect(documents.find((d) => d.key === "legal_safeguarding")).toEqual({
      key: "legal_safeguarding",
      kind: "legal",
      editable: true,
      published: { version: 1, publishedAt },
      hasDraft: true,
    });
    expect(documents.find((d) => d.key === "legal_terms")).toEqual({
      key: "legal_terms",
      kind: "legal",
      editable: true,
      published: null,
      hasDraft: true,
    });
    expect(documents.find((d) => d.key === "home")).toEqual({
      key: "home",
      kind: "home",
      editable: false,
      published: null,
      hasDraft: false,
    });
  });

  it("lists a document's revisions newest first, with who made them", async () => {
    const h = await createHarness();
    const { account, actor } = await contentManager(h);
    const v1 = await publish(h, actor, "legal_safeguarding", legalBody("1."));
    h.clock.advance({ hours: 1 });
    const draft = await h.as(actor).saveDraft({
      key: "legal_safeguarding",
      body: legalBody("2."),
    });
    if (!draft.ok) throw new Error("not saved");

    const revisions = await h.as(actor).listRevisions({
      key: "legal_safeguarding",
    });

    expect(revisions).toEqual({
      ok: true,
      revisions: [
        expect.objectContaining({
          id: draft.revisionId,
          status: "draft",
          version: null,
          publishedAt: null,
          createdBy: { id: account.id, name: "Chitra Content" },
        }),
        expect.objectContaining({
          id: v1.revisionId,
          status: "published",
          version: 1,
          publishedBy: { id: account.id, name: "Chitra Content" },
        }),
      ],
    });
  });
});

describe("who may edit the CMS", () => {
  const REFUSED_ROLES: { who: string; roles: Role[] }[] = [
    { who: "a member", roles: [] },
    { who: "a staff admin", roles: ["staff_admin"] },
    { who: "a competition manager", roles: ["competition_manager"] },
    { who: "a super admin", roles: ["super_admin"] },
  ];

  async function draftToPublish(h: Harness) {
    const { actor } = await contentManager(h);
    const saved = await h.as(actor).saveDraft({
      key: "legal_safeguarding",
      body: legalBody("Draft."),
    });
    if (!saved.ok) throw new Error("not saved");
    return saved.revisionId;
  }

  function attempts(h: Harness, actor: Actor, revisionId: string) {
    return {
      saveDraft: () =>
        h.as(actor).saveDraft({
          key: "legal_safeguarding",
          body: legalBody("Mine."),
        }),
      publishRevision: () => h.as(actor).publishRevision({ revisionId }),
      listRevisions: () =>
        h.as(actor).listRevisions({ key: "legal_safeguarding" }),
      listCmsDocuments: () => h.as(actor).listCmsDocuments(),
    };
  }

  for (const { who, roles } of REFUSED_ROLES) {
    it(`refuses ${who} everything, and writes nothing`, async () => {
      const h = await createHarness();
      const revisionId = await draftToPublish(h);
      const actor = await holding(h, ...roles);
      const before = await rowCounts(h);

      for (const [name, attempt] of Object.entries(
        attempts(h, actor, revisionId)
      )) {
        await expect(attempt(), name).rejects.toMatchObject({
          code: "forbidden",
        });
      }
      expect(await rowCounts(h)).toEqual(before);
      expect(await revisionsOf(h, "legal_safeguarding")).toEqual([
        expect.objectContaining({ status: "draft", body: legalBody("Draft.") }),
      ]);
    });
  }

  it("refuses a visitor everything", async () => {
    const h = await createHarness();
    const revisionId = await draftToPublish(h);

    for (const [name, attempt] of Object.entries(
      attempts(h, h.visitor(), revisionId)
    )) {
      await expect(attempt(), name).rejects.toMatchObject({
        code: "forbidden",
      });
    }
  });

  it("asks a content manager for their second factor first", async () => {
    const h = await createHarness();
    const revisionId = await draftToPublish(h);
    const account = await h.seed.member();
    await h.seed.grant(account, { role: "content_manager", scope: global });
    await h.seed.authenticator(account);
    const actor = await h.signIn(account, undefined, { secondFactor: false });

    for (const [name, attempt] of Object.entries(
      attempts(h, actor, revisionId)
    )) {
      await expect(attempt(), name).rejects.toMatchObject({
        code: "second_factor_required",
      });
    }
  });

  it("lets a content manager with a second factor do everything", async () => {
    const h = await createHarness();
    const revisionId = await draftToPublish(h);
    const { actor } = await contentManager(h);
    const allowed = attempts(h, actor, revisionId);

    expect(await allowed.listCmsDocuments()).toHaveLength(8);
    expect(await allowed.listRevisions()).toMatchObject({ ok: true });
    expect(await allowed.publishRevision()).toMatchObject({ ok: true });
    expect(await allowed.saveDraft()).toMatchObject({ ok: true });
  });
});
