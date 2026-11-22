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
