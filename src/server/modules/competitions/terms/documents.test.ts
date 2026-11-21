import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { competitionConsentDocument } from "@/server/db/schema";
import { createHarness, type Harness } from "@/test/harness";

import {
  competitionAudit,
  publishDocument,
  seedCompetition,
  signInManager,
  termsRowCounts,
} from "./testing";

async function pins(h: Harness, competitionId: string) {
  return h.db
    .select({
      purpose: competitionConsentDocument.purpose,
      documentId: competitionConsentDocument.consentDocumentId,
    })
    .from(competitionConsentDocument)
    .where(eq(competitionConsentDocument.competitionId, competitionId))
    .orderBy(competitionConsentDocument.purpose);
}

async function documentsForEdit(
  h: Harness,
  actor: Parameters<Harness["as"]>[0],
  competitionId: string
) {
  const edit = await h.as(actor).getCompetitionTermsForEdit({ competitionId });
  if (!edit.ok) throw new Error(edit.error);
  return edit.terms.documents;
}

describe("attachConsentDocument", () => {
  it("pins the version it attached while a newer one is published, until re-attached", async () => {
    const h = await createHarness();
    const manager = await signInManager(h);
    const { id } = await seedCompetition(h);
    const v1 = await publishDocument(h, "competition_terms", "v1");

    expect(
      await h
        .as(manager)
        .attachConsentDocument({
          competitionId: id,
          purpose: "competition_terms",
        })
    ).toEqual({ ok: true, changed: true, document: { id: v1.id, version: 1 } });

    const v2 = await publishDocument(h, "competition_terms", "v2");
    expect(await pins(h, id)).toEqual([
      { purpose: "competition_terms", documentId: v1.id },
    ]);
    const [terms] = await documentsForEdit(h, manager, id);
    expect(terms).toEqual({
      purpose: "competition_terms",
      required: true,
      state: "newer_available",
      pinned: { id: v1.id, version: 1, title: "Draft competition_terms" },
      latest: { id: v2.id, version: 2, title: "Draft competition_terms" },
    });

    expect(
      await h
        .as(manager)
        .attachConsentDocument({
          competitionId: id,
          purpose: "competition_terms",
        })
    ).toEqual({ ok: true, changed: true, document: { id: v2.id, version: 2 } });
    expect(await pins(h, id)).toEqual([
      { purpose: "competition_terms", documentId: v2.id },
    ]);
    expect((await documentsForEdit(h, manager, id))[0]?.state).toBe("current");
  });

  it("changes nothing and records nothing when the latest version is already pinned", async () => {
    const h = await createHarness();
    const manager = await signInManager(h);
    const { id } = await seedCompetition(h);
    const v1 = await publishDocument(h, "privacy_notice");
    await h
      .as(manager)
      .attachConsentDocument({ competitionId: id, purpose: "privacy_notice" });

    expect(
      await h
        .as(manager)
        .attachConsentDocument({ competitionId: id, purpose: "privacy_notice" })
    ).toEqual({
      ok: true,
      changed: false,
      document: { id: v1.id, version: 1 },
    });
    expect(await competitionAudit(h, id)).toHaveLength(1);
  });

  it("shows a purpose with no pin as not attached", async () => {
    const h = await createHarness();
    const manager = await signInManager(h);
    const { id } = await seedCompetition(h);

    expect(await documentsForEdit(h, manager, id)).toEqual([
      {
        purpose: "competition_terms",
        required: true,
        state: "not_attached",
        pinned: null,
        latest: null,
      },
      {
        purpose: "privacy_notice",
        required: true,
        state: "not_attached",
        pinned: null,
        latest: null,
      },
    ]);
  });

  describe("refuses, writing nothing", () => {
    it("a purpose a competition can't attach", async () => {
      const h = await createHarness();
      const manager = await signInManager(h);
      const { id } = await seedCompetition(h);
      await publishDocument(h, "messages");
      const before = await termsRowCounts(h);

      expect(
        await h
          .as(manager)
          .attachConsentDocument({ competitionId: id, purpose: "messages" })
      ).toEqual({ ok: false, error: "not_attachable" });
      expect(await termsRowCounts(h)).toEqual(before);
    });

    it("a purpose with no published version", async () => {
      const h = await createHarness();
      const manager = await signInManager(h);
      const { id } = await seedCompetition(h);
      const before = await termsRowCounts(h);

      expect(
        await h.as(manager).attachConsentDocument({
          competitionId: id,
          purpose: "competition_terms",
        })
      ).toEqual({ ok: false, error: "no_published_version" });
      expect(await termsRowCounts(h)).toEqual(before);
    });
  });
});

describe("detachConsentDocument", () => {
  it("removes the pin once, then changes nothing", async () => {
    const h = await createHarness();
    const manager = await signInManager(h);
    const { id } = await seedCompetition(h);
    await publishDocument(h, "competition_terms");
    await h
      .as(manager)
      .attachConsentDocument({
        competitionId: id,
        purpose: "competition_terms",
      });

    expect(
      await h
        .as(manager)
        .detachConsentDocument({
          competitionId: id,
          purpose: "competition_terms",
        })
    ).toEqual({ ok: true, changed: true });
    expect(await pins(h, id)).toEqual([]);
    expect(
      await h
        .as(manager)
        .detachConsentDocument({
          competitionId: id,
          purpose: "competition_terms",
        })
    ).toEqual({ ok: true, changed: false });
  });

  it("refuses a purpose a competition can't attach", async () => {
    const h = await createHarness();
    const manager = await signInManager(h);
    const { id } = await seedCompetition(h);

    expect(
      await h
        .as(manager)
        .detachConsentDocument({ competitionId: id, purpose: "terms" })
    ).toEqual({ ok: false, error: "not_attachable" });
  });
});

describe("the audit log for documents", () => {
  it("records each attach, move and detach once, and no no-op", async () => {
    const h = await createHarness();
    const manager = await signInManager(h);
    const { id } = await seedCompetition(h);
    const v1 = await publishDocument(h, "competition_terms", "v1");
    const attach = () =>
      h
        .as(manager)
        .attachConsentDocument({
          competitionId: id,
          purpose: "competition_terms",
        });

    await attach();
    const v2 = await publishDocument(h, "competition_terms", "v2");
    await attach();
    await attach();
    await h
      .as(manager)
      .detachConsentDocument({
        competitionId: id,
        purpose: "competition_terms",
      });
    await h
      .as(manager)
      .detachConsentDocument({
        competitionId: id,
        purpose: "competition_terms",
      });

    const pinOf = (document: { id: string; version: number }) => ({
      purpose: "competition_terms",
      documentId: document.id,
      version: document.version,
    });
    expect(await competitionAudit(h, id)).toEqual([
      {
        action: "competition.consent_document_attached",
        actorRole: "competition_manager",
        before: null,
        after: pinOf(v1),
      },
      {
        action: "competition.consent_document_attached",
        actorRole: "competition_manager",
        before: pinOf(v1),
        after: pinOf(v2),
      },
      {
        action: "competition.consent_document_detached",
        actorRole: "competition_manager",
        before: pinOf(v2),
        after: null,
      },
    ]);
  });
});
