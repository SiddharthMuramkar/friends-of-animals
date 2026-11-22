import { describe, expect, it } from "vitest";

import { placeholder } from "@/lib/site";
import { createHarness, type Harness } from "@/test/harness";

import { ORG_FACTS_TAG } from "./domain/documents";
import {
  EMPTY_TAX_FACTS,
  missingOrgFacts,
  orgFactsFrom,
} from "./domain/org-facts";

const global = { type: "global" } as const;

const SITE_FACTS = {
  email: "hello@friendsofanimals.example",
  phone: "+91 80 1234 5678",
  address: "12 Example Road, Bengaluru 560001",
  socials: ["https://www.instagram.com/example"],
  grievanceOfficer: {
    name: "A. Example",
    email: "grievance@friendsofanimals.example",
  },
};

async function contentManager(h: Harness) {
  const account = await h.seed.member({ name: "Chitra Content" });
  await h.seed.grant(account, { role: "content_manager", scope: global });
  return h.signIn(account);
}

describe("organisation facts from the site facts document", () => {
  it("refreshes the shared facts when site facts are published", async () => {
    const h = await createHarness();
    const actor = await contentManager(h);

    const saved = await h
      .as(actor)
      .saveDraft({ key: "site_facts", body: SITE_FACTS });
    if (!saved.ok) throw new Error(JSON.stringify(saved));
    const published = await h
      .as(actor)
      .publishRevision({ revisionId: saved.revisionId });

    expect(published).toMatchObject({ ok: true });
    expect(published.ok && published.tags).toEqual(
      expect.arrayContaining(["cms:site_facts", ORG_FACTS_TAG])
    );
  });

  it("merges the published site facts with the tax facts", async () => {
    const h = await createHarness();
    const actor = await contentManager(h);
    const saved = await h
      .as(actor)
      .saveDraft({ key: "site_facts", body: SITE_FACTS });
    if (!saved.ok) throw new Error(JSON.stringify(saved));
    await h.as(actor).publishRevision({ revisionId: saved.revisionId });

    const facts = orgFactsFrom(
      { ...EMPTY_TAX_FACTS, legalName: "Friends of Animals Foundation" },
      await h.as(h.visitor()).getPublishedDocument({ key: "site_facts" })
    );

    expect(facts).toMatchObject({
      legalName: "Friends of Animals Foundation",
      email: SITE_FACTS.email,
      grievanceOfficer: SITE_FACTS.grievanceOfficer,
      socials: SITE_FACTS.socials,
    });
    expect(facts.registration.pan).toEqual(placeholder("pan"));
    expect(missingOrgFacts(facts)).toEqual([
      "registrationType",
      "registrationNumber",
      "pan",
    ]);
  });

  it("merges a super admin's tax settings with the published site facts", async () => {
    const h = await createHarness();
    const actor = await contentManager(h);
    const saved = await h
      .as(actor)
      .saveDraft({ key: "site_facts", body: SITE_FACTS });
    if (!saved.ok) throw new Error(JSON.stringify(saved));
    await h.as(actor).publishRevision({ revisionId: saved.revisionId });
    const admin = await h.signIn(await h.seed.superAdmin());
    h.clock.advance({ minutes: 1 });
    for (const [key, value] of [
      ["org.legalName", "  Friends of Animals Foundation "],
      ["org.registrationType", "Section 8 company"],
    ] as const) {
      expect(await h.as(admin).changeSetting({ key, value })).toMatchObject({
        ok: true,
      });
    }

    const facts = await h.as(h.visitor()).getOrgFacts();

    expect(facts).toMatchObject({
      legalName: "Friends of Animals Foundation",
      registration: { type: "Section 8 company" },
      email: SITE_FACTS.email,
      grievanceOfficer: SITE_FACTS.grievanceOfficer,
    });
    expect(missingOrgFacts(facts)).toEqual(["registrationNumber", "pan"]);
  });

  it("reads every fact as a placeholder on a fresh database", async () => {
    const h = await createHarness();

    const facts = await h.as(h.visitor()).getOrgFacts();

    expect(missingOrgFacts(facts)).toEqual([
      "legalName",
      "email",
      "phone",
      "address",
      "registrationType",
      "registrationNumber",
      "pan",
      "grievanceOfficerName",
      "grievanceOfficerEmail",
      "socials",
    ]);
  });

  it("shows every fact as a placeholder before anything is published", async () => {
    const h = await createHarness();

    const facts = orgFactsFrom(
      EMPTY_TAX_FACTS,
      await h.as(h.visitor()).getPublishedDocument({ key: "site_facts" })
    );

    expect(missingOrgFacts(facts)).toHaveLength(10);
  });

  it("lets only a content manager edit site facts", async () => {
    const h = await createHarness();
    const account = await h.seed.member();
    await h.seed.grant(account, { role: "staff_admin", scope: global });
    const staffAdmin = await h.signIn(account);

    await expect(
      h.as(staffAdmin).saveDraft({ key: "site_facts", body: SITE_FACTS })
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("seeds site facts empty, so previews show placeholders", async () => {
    const h = await createHarness();
    await h.seed.preview();

    const facts = orgFactsFrom(
      EMPTY_TAX_FACTS,
      await h.as(h.visitor()).getPublishedDocument({ key: "site_facts" })
    );

    expect(facts.email).toEqual(placeholder("email"));
  });
});

describe("previewing a site facts draft", () => {
  const DRAFT_EMAIL = "draft@friendsofanimals.example";

  async function publishedWithDraft(h: Harness) {
    const actor = await contentManager(h);
    const saved = await h
      .as(actor)
      .saveDraft({ key: "site_facts", body: SITE_FACTS });
    if (!saved.ok) throw new Error(JSON.stringify(saved));
    await h.as(actor).publishRevision({ revisionId: saved.revisionId });
    h.clock.advance({ minutes: 1 });
    const draft = await h.as(actor).saveDraft({
      key: "site_facts",
      body: { ...SITE_FACTS, email: DRAFT_EMAIL },
    });
    if (!draft.ok) throw new Error(JSON.stringify(draft));
    return actor;
  }

  it("previews site facts on the contact page, where they show", async () => {
    const h = await createHarness();
    const actor = await contentManager(h);

    expect(await h.as(actor).startPreview({ key: "site_facts" })).toEqual({
      ok: true,
      path: "/contact",
    });
  });

  it("shows a content manager the draft facts while everyone else still reads the published ones", async () => {
    const h = await createHarness();
    const actor = await publishedWithDraft(h);
    const admin = await h.signIn(await h.seed.superAdmin());
    h.clock.advance({ minutes: 1 });
    expect(
      await h.as(admin).changeSetting({
        key: "org.legalName",
        value: "Friends of Animals Foundation",
      })
    ).toMatchObject({ ok: true });

    const preview = await h.as(actor).getOrgFactsForPreview();

    // The draft's site facts, with the tax facts settings hold now.
    expect(preview).toMatchObject({
      legalName: "Friends of Animals Foundation",
      email: DRAFT_EMAIL,
      phone: SITE_FACTS.phone,
      grievanceOfficer: SITE_FACTS.grievanceOfficer,
    });
    for (const who of [h.visitor(), actor]) {
      expect(await h.as(who).getOrgFacts()).toMatchObject({
        legalName: "Friends of Animals Foundation",
        email: SITE_FACTS.email,
      });
    }
  });

  it("is null when site facts have no open draft", async () => {
    const h = await createHarness();
    const actor = await contentManager(h);

    expect(await h.as(actor).getOrgFactsForPreview()).toBeNull();
  });

  it("refuses the draft facts to anyone who may not preview drafts", async () => {
    const h = await createHarness();
    await publishedWithDraft(h);
    const member = await h.signIn(await h.seed.member());
    const staffAccount = await h.seed.member();
    await h.seed.grant(staffAccount, { role: "staff_admin", scope: global });
    const staffAdmin = await h.signIn(staffAccount);

    for (const who of [h.visitor(), member, staffAdmin]) {
      await expect(h.as(who).getOrgFactsForPreview()).rejects.toMatchObject({
        code: "forbidden",
      });
    }
  });
});

describe("orgFactsReadiness", () => {
  it("tells staff which facts are still missing, by placeholder key", async () => {
    const h = await createHarness();
    const actor = await contentManager(h);
    const saved = await h
      .as(actor)
      .saveDraft({ key: "site_facts", body: SITE_FACTS });
    if (!saved.ok) throw new Error(JSON.stringify(saved));
    await h.as(actor).publishRevision({ revisionId: saved.revisionId });
    const admin = await h.signIn(await h.seed.superAdmin());
    const staffAccount = await h.seed.member();
    await h.seed.grant(staffAccount, { role: "staff_admin", scope: global });
    const staffAdmin = await h.signIn(staffAccount);

    for (const who of [actor, admin, staffAdmin]) {
      expect(await h.as(who).orgFactsReadiness()).toEqual({
        missing: ["legalName", "registrationType", "registrationNumber", "pan"],
      });
    }
  });

  it("refuses members and visitors: the public health check names none", async () => {
    const h = await createHarness();
    const member = await h.signIn(await h.seed.member());

    for (const who of [member, h.visitor()]) {
      await expect(h.as(who).orgFactsReadiness()).rejects.toMatchObject({
        code: "forbidden",
      });
    }
  });
});
