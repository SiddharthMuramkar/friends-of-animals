import { count, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { LEGAL_DOCS } from "@/content/legal";
import { MESSAGES_CONSENT_DRAFT } from "@/content/legal/messages-consent";
import { auditLog, consentDocument } from "@/server/db/schema";
import { SEED_ACCOUNTS } from "@/server/seed";
import { createHarness, type Harness } from "@/test/harness";

import { toConsentDocumentBody } from "./domain/document-body";

const SOURCE_V1 = [
  "- We keep only what a competition needs.",
  "",
  "## Who we are {#who-we-are}",
  "",
  "Friends of Animals runs art competitions.",
].join("\n");

const SOURCE_V2 = [
  "- We keep only what a competition needs.",
  "- You can ask us to delete it.",
  "",
  "## Who we are {#who-we-are}",
  "",
  "Friends of Animals runs art competitions for schools.",
].join("\n");

/**
 * The trigger's refusal. Drizzle wraps the driver's error in its own, whose
 * message is the failed query, and keeps what Postgres said as `cause`.
 */
function refusedWith(operation: string) {
  return {
    cause: {
      message: `consent_document is immutable: ${operation} is not allowed; publish a new version`,
    },
  };
}

async function rowCounts(h: Harness) {
  const [documents] = await h.db.select({ n: count() }).from(consentDocument);
  const [entries] = await h.db.select({ n: count() }).from(auditLog);
  return { documents: documents?.n, auditEntries: entries?.n };
}

async function staffAdmin(h: Harness) {
  const admin = await h.seed.member({ name: "Sunita Staff" });
  await h.seed.grant(admin, { role: "staff_admin", scope: { type: "global" } });
  return { account: admin, actor: await h.signIn(admin) };
}

describe("publishConsentDocument", () => {
  it("publishes the next version and leaves the older one unchanged", async () => {
    const h = await createHarness();
    const { account, actor } = await staffAdmin(h);
    const firstPublishedAt = h.clock.now();

    expect(
      await h.as(actor).publishConsentDocument({
        purpose: "privacy_notice",
        title: "Privacy policy",
        source: SOURCE_V1,
      })
    ).toEqual({ ok: true, id: expect.any(String), version: 1 });
    const [v1Before] = await h
      .as(actor)
      .listConsentDocumentVersions({ purpose: "privacy_notice" });

    h.clock.advance({ days: 3 });
    const published = await h.as(actor).publishConsentDocument({
      purpose: "privacy_notice",
      title: "Privacy policy (schools)",
      source: SOURCE_V2,
    });

    expect(published).toEqual({ ok: true, id: expect.any(String), version: 2 });
    const versions = await h
      .as(actor)
      .listConsentDocumentVersions({ purpose: "privacy_notice" });
    expect(versions.map((v) => v.version)).toEqual([2, 1]);
    expect(versions[1]).toEqual(v1Before);
    expect(versions[1]).toEqual({
      id: v1Before?.id,
      purpose: "privacy_notice",
      version: 1,
      title: "Privacy policy",
      body: {
        short: [["We keep only what a competition needs."]],
        sections: [
          {
            id: "who-we-are",
            title: "Who we are",
            blocks: [{ p: ["Friends of Animals runs art competitions."] }],
          },
        ],
      },
      publishedAt: firstPublishedAt,
      publishedBy: { id: account.id, name: "Sunita Staff" },
    });
    expect(versions[0]).toMatchObject({
      version: 2,
      title: "Privacy policy (schools)",
      publishedAt: h.clock.now(),
    });
  });
});

describe("publishConsentDocument and listConsentDocumentVersions: who may", () => {
  const draft = {
    purpose: "privacy_notice",
    title: "Privacy policy",
    source: SOURCE_V1,
  } as const;

  it("refuses to publish or list versions for a member, a visitor and a holder of a scoped role, and writes nothing", async () => {
    const h = await createHarness();
    const member = await h.signIn(await h.seed.member());
    const coordinator = await h.seed.member();
    await h.seed.grant(coordinator, {
      role: "institution_admin",
      scope: {
        type: "institution",
        id: "01938a00-0000-7000-8000-00000000a001",
      },
    });
    const scoped = await h.signIn(coordinator);

    for (const actor of [member, h.visitor(), scoped]) {
      await expect(
        h.as(actor).publishConsentDocument(draft)
      ).rejects.toMatchObject({ name: "DomainError", code: "forbidden" });
      await expect(
        h.as(actor).listConsentDocumentVersions({ purpose: "privacy_notice" })
      ).rejects.toMatchObject({ code: "forbidden" });
    }
    expect(await rowCounts(h)).toEqual({ documents: 0, auditEntries: 0 });
  });

  it("lets a super admin publish, and audits who published which version", async () => {
    const h = await createHarness();
    const admin = await h.seed.superAdmin();
    const actor = await h.signIn(admin, {
      ip: "198.51.100.20",
      userAgent: "Publisher browser",
    });

    const first = await h.as(actor).publishConsentDocument(draft);
    const second = await h.as(actor).publishConsentDocument(draft);

    const entries = await h.db.select().from(auditLog).orderBy(auditLog.id);
    expect(entries).toEqual([
      expect.objectContaining({
        actorKind: "user",
        actorUserId: admin.id,
        actorRole: "super_admin",
        action: "consent_document.published",
        entityType: "consent_document",
        entityId: first.ok ? first.id : "",
        before: null,
        after: {
          documentId: first.ok ? first.id : "",
          purpose: "privacy_notice",
          version: 1,
        },
        ip: "198.51.100.20",
        userAgent: "Publisher browser",
      }),
      expect.objectContaining({
        action: "consent_document.published",
        entityId: second.ok ? second.id : "",
        before: { documentId: first.ok ? first.id : "", version: 1 },
        after: {
          documentId: second.ok ? second.id : "",
          purpose: "privacy_notice",
          version: 2,
        },
      }),
    ]);
  });

  it("returns line-numbered errors for a source it can't read, and publishes nothing", async () => {
    const h = await createHarness();
    const { actor } = await staffAdmin(h);

    expect(
      await h.as(actor).publishConsentDocument({
        ...draft,
        source: "## Who we are\n\nWrite to {{nobody}}.",
      })
    ).toEqual({
      ok: false,
      error: "invalid_source",
      errors: [{ line: 3, code: "unknown_fact" }],
    });
    expect(
      await h.as(actor).publishConsentDocument({ ...draft, title: "  " })
    ).toEqual({ ok: false, error: "invalid_input", fields: ["title"] });
    expect(await rowCounts(h)).toEqual({ documents: 0, auditEntries: 0 });
  });
});

describe("previewConsentDocument", () => {
  it("shows staff the body a source would publish, or its errors, and saves nothing", async () => {
    const h = await createHarness();
    const { actor } = await staffAdmin(h);

    expect(
      await h.as(actor).previewConsentDocument({ source: SOURCE_V1 })
    ).toEqual({
      ok: true,
      body: {
        short: [["We keep only what a competition needs."]],
        sections: [
          {
            id: "who-we-are",
            title: "Who we are",
            blocks: [{ p: ["Friends of Animals runs art competitions."] }],
          },
        ],
      },
    });
    expect(
      await h.as(actor).previewConsentDocument({ source: "Just text." })
    ).toEqual({
      ok: false,
      error: "invalid_source",
      errors: [
        { line: 1, code: "text_before_first_section" },
        { line: null, code: "no_sections" },
      ],
    });
    expect(await rowCounts(h)).toEqual({ documents: 0, auditEntries: 0 });
  });

  it("refuses anyone who may not publish", async () => {
    const h = await createHarness();
    const member = await h.signIn(await h.seed.member());

    await expect(
      h.as(member).previewConsentDocument({ source: SOURCE_V1 })
    ).rejects.toMatchObject({ code: "forbidden" });
  });
});

describe("consent_document", () => {
  it("refuses to update or delete a published version, even in raw SQL", async () => {
    const h = await createHarness();
    const { actor } = await staffAdmin(h);
    await h.as(actor).publishConsentDocument({
      purpose: "terms",
      title: "Terms of use",
      source: SOURCE_V1,
    });
    const before = await h.db.select().from(consentDocument);

    await expect(
      h.db.execute(sql`update consent_document set title = 'Changed'`)
    ).rejects.toMatchObject(refusedWith("UPDATE"));
    await expect(
      h.db.execute(sql`delete from consent_document`)
    ).rejects.toMatchObject(refusedWith("DELETE"));
    await expect(
      h.db.execute(sql`truncate consent_document cascade`)
    ).rejects.toMatchObject(refusedWith("TRUNCATE"));

    expect(await h.db.select().from(consentDocument)).toEqual(before);
  });
});

describe("currentConsentDocument", () => {
  it("is null before the first version, then the latest version, for anyone", async () => {
    const h = await createHarness();
    const { actor } = await staffAdmin(h);
    const visitor = h.visitor();

    expect(
      await h.as(visitor).currentConsentDocument({ purpose: "messages" })
    ).toBeNull();

    await h.as(actor).publishConsentDocument({
      purpose: "messages",
      title: "News and updates",
      source: SOURCE_V1,
    });
    h.clock.advance({ hours: 1 });
    const v2 = await h.as(actor).publishConsentDocument({
      purpose: "messages",
      title: "News and updates, v2",
      source: SOURCE_V2,
    });

    expect(
      await h.as(visitor).currentConsentDocument({ purpose: "messages" })
    ).toEqual({
      id: v2.ok ? v2.id : "",
      purpose: "messages",
      version: 2,
      title: "News and updates, v2",
      body: {
        short: [
          ["We keep only what a competition needs."],
          ["You can ask us to delete it."],
        ],
        sections: [
          {
            id: "who-we-are",
            title: "Who we are",
            blocks: [
              { p: ["Friends of Animals runs art competitions for schools."] },
            ],
          },
        ],
      },
      publishedAt: h.clock.now(),
    });
    expect(
      await h.as(visitor).currentConsentDocument({ purpose: "terms" })
    ).toBeNull();
  });
});

describe("the preview seed", () => {
  it("publishes version 1 of the privacy notice, the terms and the messages consent, once", async () => {
    const h = await createHarness();
    await h.seed.preview();
    h.clock.advance({ days: 1 });
    await h.seed.preview();

    const admin = await h.signIn(SEED_ACCOUNTS.superAdmin);
    const versions = async (purpose: "privacy_notice" | "terms" | "messages") =>
      (await h.as(admin).listConsentDocumentVersions({ purpose })).map(
        ({ version, title, body, publishedBy }) => ({
          version,
          title,
          body,
          publishedBy,
        })
      );
    const seededAdmin = {
      id: SEED_ACCOUNTS.superAdmin.id,
      name: SEED_ACCOUNTS.superAdmin.name,
    };

    expect(await versions("privacy_notice")).toEqual([
      {
        version: 1,
        title: "Privacy policy",
        body: toConsentDocumentBody(LEGAL_DOCS.privacy),
        publishedBy: seededAdmin,
      },
    ]);
    expect(await versions("terms")).toEqual([
      {
        version: 1,
        title: "Terms of use",
        body: toConsentDocumentBody(LEGAL_DOCS.terms),
        publishedBy: seededAdmin,
      },
    ]);
    expect(await versions("messages")).toEqual([
      {
        version: 1,
        title: MESSAGES_CONSENT_DRAFT.title,
        body: {
          short: MESSAGES_CONSENT_DRAFT.short,
          sections: MESSAGES_CONSENT_DRAFT.sections,
        },
        publishedBy: seededAdmin,
      },
    ]);
  });
});
