import { and, asc, count, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { LEGAL_DOCS } from "@/content/legal";
import type { Actor } from "@/server/actor";
import {
  auditLog,
  cmsDocument,
  cmsRevision,
  consentDocument,
} from "@/server/db/schema";
import { toConsentDocumentBody } from "@/server/modules/consent/domain/document-body";
import { createHarness, type Harness } from "@/test/harness";

import type { CmsDocumentKey } from "./domain/documents";

const global = { type: "global" } as const;

function legalBody(paragraph: string) {
  return {
    short: [["The short version."]],
    sections: [
      {
        id: "who-we-are",
        title: "Who we are",
        blocks: [{ p: [paragraph] }],
      },
    ],
  };
}

async function contentManager(h: Harness) {
  const account = await h.seed.member({ name: "Chitra Content" });
  await h.seed.grant(account, { role: "content_manager", scope: global });
  return { account, actor: await h.signIn(account) };
}

async function publish(
  h: Harness,
  actor: Actor,
  key: CmsDocumentKey,
  body: unknown
) {
  const saved = await h.as(actor).saveDraft({ key, body });
  if (!saved.ok) throw new Error(`Could not save: ${JSON.stringify(saved)}`);
  const published = await h.as(actor).publishRevision({
    revisionId: saved.revisionId,
  });
  if (!published.ok) throw new Error("Could not publish");
  return { revisionId: saved.revisionId, ...published };
}

async function consentVersions(
  h: Harness,
  purpose: "privacy_notice" | "terms" | "messages"
) {
  return h.db
    .select({
      version: consentDocument.version,
      title: consentDocument.title,
      body: consentDocument.body,
      legalRevisionId: consentDocument.legalRevisionId,
      publishedAt: consentDocument.publishedAt,
      publishedByUserId: consentDocument.publishedByUserId,
    })
    .from(consentDocument)
    .where(eq(consentDocument.purpose, purpose))
    .orderBy(asc(consentDocument.version));
}

describe("publishing a legal page", () => {
  it("publishes the next privacy notice with the same text, linked to the revision", async () => {
    const h = await createHarness();
    const { account, actor } = await contentManager(h);
    const v1 = await publish(h, actor, "legal_privacy", legalBody("One."));
    h.clock.advance({ days: 2 });

    const v2 = await publish(h, actor, "legal_privacy", legalBody("Two."));

    expect(await consentVersions(h, "privacy_notice")).toEqual([
      expect.objectContaining({
        version: 1,
        title: "Privacy policy",
        body: legalBody("One."),
        legalRevisionId: v1.revisionId,
      }),
      {
        version: 2,
        title: "Privacy policy",
        body: legalBody("Two."),
        legalRevisionId: v2.revisionId,
        publishedAt: h.clock.now(),
        publishedByUserId: account.id,
      },
    ]);
    expect(
      await h.as(h.visitor()).currentLegalVersion({ key: "legal_privacy" })
    ).toEqual({ version: 2, publishedAt: h.clock.now() });
    expect(v2.tags).toEqual([
      "cms:legal_privacy",
      "consent-document:privacy_notice",
    ]);
  });

  it("publishes the next terms with the title the last version had", async () => {
    const h = await createHarness();
    await h.seed.preview();
    const { actor } = await contentManager(h);

    const published = await publish(h, actor, "legal_terms", legalBody("New."));

    expect(published.version).toBe(2);
    expect(published.tags).toEqual([
      "cms:legal_terms",
      "consent-document:terms",
    ]);
    expect(await consentVersions(h, "terms")).toEqual([
      expect.objectContaining({ version: 1, legalRevisionId: null }),
      expect.objectContaining({
        version: 2,
        title: "Terms of use",
        body: legalBody("New."),
        legalRevisionId: published.revisionId,
      }),
    ]);
  });

  it("audits the consent document it publishes", async () => {
    const h = await createHarness();
    const { actor } = await contentManager(h);

    const published = await publish(h, actor, "legal_terms", legalBody("T."));

    const entries = await h.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, "consent_document.published"));
    expect(entries).toEqual([
      expect.objectContaining({
        actorRole: "content_manager",
        entityType: "consent_document",
        before: null,
        after: {
          documentId: entries[0]?.entityId,
          purpose: "terms",
          version: 1,
          legalRevisionId: published.revisionId,
        },
      }),
    ]);
  });

  it("publishes no consent document for the safeguarding and child protection pages", async () => {
    const h = await createHarness();
    const { actor } = await contentManager(h);

    const safeguarding = await publish(
      h,
      actor,
      "legal_safeguarding",
      legalBody("S.")
    );
    await publish(h, actor, "legal_child_protection", legalBody("C."));

    expect(safeguarding.tags).toEqual(["cms:legal_safeguarding"]);
    const [documents] = await h.db.select({ n: count() }).from(consentDocument);
    expect(documents?.n).toBe(0);
  });

  it("has no current version before the first publish", async () => {
    const h = await createHarness();

    expect(
      await h.as(h.visitor()).currentLegalVersion({ key: "legal_terms" })
    ).toBeNull();
  });
});

describe("publishing the messages consent", () => {
  it("records the privacy page revision it rests on", async () => {
    const h = await createHarness();
    const { actor: manager } = await contentManager(h);
    const privacy = await publish(h, manager, "legal_privacy", legalBody("P."));
    const admin = await h.seed.member({ name: "Sunita Staff" });
    await h.seed.grant(admin, { role: "staff_admin", scope: global });
    const staff = await h.signIn(admin);

    const published = await h.as(staff).publishConsentDocument({
      purpose: "messages",
      title: "Messages from Friends of Animals",
      source: "## Messages\n\nWe send news about competitions.",
    });

    expect(published).toMatchObject({ ok: true, version: 1 });
    expect(await consentVersions(h, "messages")).toEqual([
      expect.objectContaining({ legalRevisionId: privacy.revisionId }),
    ]);
  });

  it("records no revision while the privacy page has none", async () => {
    const h = await createHarness();
    const admin = await h.seed.member();
    await h.seed.grant(admin, { role: "staff_admin", scope: global });
    const staff = await h.signIn(admin);

    await h.as(staff).publishConsentDocument({
      purpose: "messages",
      title: "Messages",
      source: "## Messages\n\nWe send news.",
    });

    expect(await consentVersions(h, "messages")).toEqual([
      expect.objectContaining({ legalRevisionId: null }),
    ]);
  });
});

describe("the preview seed", () => {
  it("publishes the repo's text as version 1 of each legal page, once, as #64 publishes it", async () => {
    const h = await createHarness();

    await h.seed.preview();
    await h.seed.preview();

    const documents = await h.db
      .select({ key: cmsDocument.key, kind: cmsDocument.kind })
      .from(cmsDocument)
      .orderBy(asc(cmsDocument.key));
    expect(documents).toEqual([
      { key: "about", kind: "page" },
      { key: "home", kind: "home" },
      { key: "impact", kind: "impact" },
      { key: "legal_child_protection", kind: "legal" },
      { key: "legal_privacy", kind: "legal" },
      { key: "legal_safeguarding", kind: "legal" },
      { key: "legal_terms", kind: "legal" },
      { key: "site_facts", kind: "facts" },
    ]);
    const repoText = {
      legal_privacy: LEGAL_DOCS.privacy,
      legal_terms: LEGAL_DOCS.terms,
      legal_safeguarding: LEGAL_DOCS.safeguarding,
      legal_child_protection: LEGAL_DOCS.childProtection,
    };
    for (const [key, doc] of Object.entries(repoText)) {
      const revisions = await h.db
        .select({
          status: cmsRevision.status,
          version: cmsRevision.version,
          body: cmsRevision.body,
        })
        .from(cmsRevision)
        .innerJoin(cmsDocument, eq(cmsDocument.id, cmsRevision.documentId))
        .where(and(eq(cmsDocument.key, key)));
      expect(revisions, key).toEqual([
        {
          status: "published",
          version: 1,
          // Every clause keeps its words and facts, as in #64's seeded
          // privacy notice and terms: a revision holds no clauses.
          body: toConsentDocumentBody(doc),
        },
      ]);
    }
  });
});
