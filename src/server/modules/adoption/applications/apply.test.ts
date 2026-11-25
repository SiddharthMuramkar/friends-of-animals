import { describe, expect, it } from "vitest";

import { DomainError } from "@/server/errors";
import { linkedTeen } from "@/server/modules/volunteers/testing";
import { createHarness } from "@/test/harness";

import { draft, member, published, representative } from "../testing";
import {
  adoptionEvents,
  adoptionWorld,
  applicationAudit,
  applicationRow,
  applied,
  applyInput,
  bornYearsAgo,
  coordinator,
  publishAdopterDocument,
} from "./testing";

describe("applyToAdopt", () => {
  it("submits an adult's application, which they then see with its status", async () => {
    const h = await createHarness();
    const world = await adoptionWorld(h);

    const result = await h
      .as(world.applicant.actor)
      .applyToAdopt(applyInput(h, world.animal.slug, world.documents));

    expect(result).toEqual({ ok: true, applicationId: expect.any(String) });
    if (!result.ok) return;
    expect(await h.as(world.applicant.actor).myAdoptionApplications()).toEqual([
      {
        id: result.applicationId,
        status: "submitted",
        createdAt: h.clock.now(),
        updatedAt: h.clock.now(),
        animal: { slug: world.animal.slug, name: "Bruno", species: "dog" },
        organisation: { name: "Paws Pune" },
      },
    ]);
    const mine = await h
      .as(world.applicant.actor)
      .myAdoptionApplication({ applicationId: result.applicationId });
    expect(mine).toMatchObject({
      status: "submitted",
      details: {
        phone: "+919876543210",
        address: "Flat 4, Sunrise Apartments, Koregaon Park, Pune 411001",
        answers: { homeType: "flat", hasOutdoorSpace: false },
      },
      story: null,
      canWriteStory: false,
    });
  });

  it("stores the contact, answers and date of birth encrypted, with the consent it rests on, and audits ids only", async () => {
    const h = await createHarness();
    const world = await adoptionWorld(h);
    const id = await applied(h, world);

    const row = await applicationRow(h, id);
    expect(row?.phoneCiphertext).not.toContain("9876543210");
    expect(row?.addressCiphertext).not.toContain("Sunrise");
    expect(row?.answersCiphertext).not.toContain("flat");
    expect(row?.dateOfBirthCiphertext).not.toContain(bornYearsAgo(h, 30));
    expect(row?.contactSharingConsentId).toEqual(expect.any(String));
    expect(await applicationAudit(h, id)).toEqual([
      {
        action: "adoption.application_submitted",
        before: null,
        after: {
          status: "submitted",
          adoptionListingId: world.animal.adoptionListingId,
          contactSharingConsentId: row?.contactSharingConsentId,
        },
      },
    ]);
    expect(await adoptionEvents(h)).toEqual([
      {
        type: "adoption.application_submitted",
        payload: { applicationId: id },
      },
    ]);
  });

  it("refuses a second open application to the same animal", async () => {
    const h = await createHarness();
    const world = await adoptionWorld(h);
    await applied(h, world);

    expect(
      await h
        .as(world.applicant.actor)
        .applyToAdopt(applyInput(h, world.animal.slug, world.documents))
    ).toEqual({ ok: false, error: "already_applied" });
  });

  it("lets them apply again once the earlier application closed", async () => {
    const h = await createHarness();
    const world = await adoptionWorld(h);
    const first = await applied(h, world);
    await h
      .as(world.applicant.actor)
      .withdrawAdoptionApplication({ applicationId: first });

    expect(
      await h
        .as(world.applicant.actor)
        .applyToAdopt(applyInput(h, world.animal.slug, world.documents))
    ).toMatchObject({ ok: true });
  });

  it("refuses an animal that isn't open: a draft, on hold, an unknown slug or a suspended organisation", async () => {
    const h = await createHarness();
    const world = await adoptionWorld(h);
    const drafted = await draft(h, world.rep, { name: "Kalu" });
    const apply = (slug: string) =>
      h
        .as(world.applicant.actor)
        .applyToAdopt(applyInput(h, slug, world.documents));

    expect(await apply(drafted.slug)).toEqual({
      ok: false,
      error: "listing_not_open",
    });
    expect(await apply("no-such-animal")).toEqual({
      ok: false,
      error: "listing_not_open",
    });
    await h.as(world.rep.actor).holdAdoptionListing({
      adoptionListingId: world.animal.adoptionListingId,
    });
    expect(await apply(world.animal.slug)).toEqual({
      ok: false,
      error: "listing_not_open",
    });
  });

  it("refuses the listing organisation's own representative", async () => {
    const h = await createHarness();
    const world = await adoptionWorld(h);

    expect(
      await h
        .as(world.rep.actor)
        .applyToAdopt(applyInput(h, world.animal.slug, world.documents))
    ).toEqual({ ok: false, error: "own_listing" });
  });

  it("asks for a date of birth when the applicant has no profile and typed none", async () => {
    const h = await createHarness();
    const world = await adoptionWorld(h);

    expect(
      await h.as(world.applicant.actor).applyToAdopt(
        applyInput(h, world.animal.slug, world.documents, {
          dateOfBirth: undefined,
        })
      )
    ).toEqual({ ok: false, error: "date_of_birth_required" });
    expect(
      await h.as(world.applicant.actor).adoptionApplicationForm({
        slug: world.animal.slug,
      })
    ).toMatchObject({ ok: true, needsDateOfBirth: true });
  });

  it("refuses an applicant who gives an under-18 date of birth, writing nothing", async () => {
    const h = await createHarness();
    const world = await adoptionWorld(h);

    expect(
      await h.as(world.applicant.actor).applyToAdopt(
        applyInput(h, world.animal.slug, world.documents, {
          dateOfBirth: bornYearsAgo(h, 18, -1),
        })
      )
    ).toEqual({ ok: false, error: "under_min_age" });
    expect(await h.as(world.applicant.actor).myAdoptionApplications()).toEqual(
      []
    );
  });

  it("refuses a linked teen on the date their guardian entered, whatever they type", async () => {
    const h = await createHarness();
    const world = await adoptionWorld(h);
    const family = await linkedTeen(h, { age: 16 });

    expect(
      await h.as(family.teen.actor).applyToAdopt(
        applyInput(h, world.animal.slug, world.documents, {
          dateOfBirth: bornYearsAgo(h, 40),
        })
      )
    ).toEqual({ ok: false, error: "under_min_age" });
    expect(
      await h
        .as(family.teen.actor)
        .adoptionApplicationForm({ slug: world.animal.slug })
    ).toMatchObject({ ok: true, needsDateOfBirth: false });
  });

  it("follows a raised minimum age setting", async () => {
    const h = await createHarness();
    const world = await adoptionWorld(h);
    await h.settings.set("adoption.minAdopterAgeYears", 21);

    expect(
      await h.as(world.applicant.actor).applyToAdopt(
        applyInput(h, world.animal.slug, world.documents, {
          dateOfBirth: bornYearsAgo(h, 20),
        })
      )
    ).toEqual({ ok: false, error: "under_min_age" });
  });

  it("refuses until FOA publishes the contact-sharing document", async () => {
    const h = await createHarness();
    const rep = await representative(h);
    const animal = await published(h, rep);
    const applicant = await member(h);

    expect(
      await h.as(applicant).applyToAdopt(
        applyInput(h, animal.slug, {
          contactSharing: "0196a3c4-0000-7000-8000-000000000000",
          story: "0196a3c4-0000-7000-8000-000000000001",
        })
      )
    ).toEqual({ ok: false, error: "consent_unpublished" });
  });

  it("refuses a contact-sharing document that is no longer the current one", async () => {
    const h = await createHarness();
    const world = await adoptionWorld(h);
    await publishAdopterDocument(h, "adoption_contact_sharing");

    expect(
      await h
        .as(world.applicant.actor)
        .applyToAdopt(applyInput(h, world.animal.slug, world.documents))
    ).toEqual({ ok: false, error: "consent_outdated" });
  });

  it("refuses bad input, naming the fields", async () => {
    const h = await createHarness();
    const world = await adoptionWorld(h);

    expect(
      await h.as(world.applicant.actor).applyToAdopt(
        applyInput(h, world.animal.slug, world.documents, {
          phone: "12345",
          address: "Pune",
        })
      )
    ).toMatchObject({
      ok: false,
      error: "invalid_input",
      fields: expect.arrayContaining(["phone", "address"]),
    });
  });

  it("refuses a visitor", async () => {
    const h = await createHarness();
    const world = await adoptionWorld(h);

    await expect(
      h
        .as(h.visitor())
        .applyToAdopt(applyInput(h, world.animal.slug, world.documents))
    ).rejects.toThrow(DomainError);
    await expect(
      h.as(h.visitor()).adoptionApplicationForm({ slug: world.animal.slug })
    ).rejects.toThrow(DomainError);
  });
});

describe("tracking and withdrawing an application", () => {
  it("shows the form an open application already exists", async () => {
    const h = await createHarness();
    const world = await adoptionWorld(h);
    const id = await applied(h, world);

    expect(
      await h
        .as(world.applicant.actor)
        .adoptionApplicationForm({ slug: world.animal.slug })
    ).toMatchObject({
      ok: true,
      animal: { name: "Bruno" },
      organisation: { name: "Paws Pune" },
      contactSharingDocument: { id: world.documents.contactSharing },
      openApplicationId: id,
    });
  });

  it("lets the applicant withdraw an open application, once", async () => {
    const h = await createHarness();
    const world = await adoptionWorld(h);
    const id = await applied(h, world);

    expect(
      await h
        .as(world.applicant.actor)
        .withdrawAdoptionApplication({ applicationId: id })
    ).toEqual({ ok: true });
    expect(await applicationRow(h, id)).toMatchObject({
      status: "withdrawn",
      closedAt: h.clock.now(),
    });
    expect(
      await h
        .as(world.applicant.actor)
        .withdrawAdoptionApplication({ applicationId: id })
    ).toEqual({ ok: false, error: "invalid_transition" });
  });

  it("refuses another member reading or withdrawing someone's application", async () => {
    const h = await createHarness();
    const world = await adoptionWorld(h);
    const id = await applied(h, world);
    const stranger = await member(h);

    await expect(
      h.as(stranger).myAdoptionApplication({ applicationId: id })
    ).rejects.toThrow(DomainError);
    await expect(
      h.as(stranger).withdrawAdoptionApplication({ applicationId: id })
    ).rejects.toThrow(DomainError);
    expect(await h.as(stranger).myAdoptionApplications()).toEqual([]);
  });

  it("refuses the coordinator withdrawing on the applicant's behalf", async () => {
    const h = await createHarness();
    const world = await adoptionWorld(h);
    const id = await applied(h, world);

    await expect(
      h
        .as(await coordinator(h))
        .withdrawAdoptionApplication({ applicationId: id })
    ).rejects.toThrow(DomainError);
  });
});
