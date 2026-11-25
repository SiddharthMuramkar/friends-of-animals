import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { adoptionListing } from "@/server/db/schema";
import { DomainError } from "@/server/errors";
import { createHarness } from "@/test/harness";

import { member, published, representative, staffAdmin } from "../testing";
import {
  adopted,
  adoptionWorld,
  applicationAudit,
  applicationRow,
  applied,
  coordinator,
  inContact,
} from "./testing";

describe("the coordinator's moves", () => {
  it("moves an application through review, contact and adopted, auditing each move with ids and statuses only", async () => {
    const h = await createHarness();
    const world = await adoptionWorld(h);
    const id = await applied(h, world);
    const coord = await coordinator(h);

    expect(
      await h.as(coord).startAdoptionReview({ applicationId: id })
    ).toMatchObject({ ok: true, status: "under_review" });
    expect(
      await h.as(coord).putAdopterInContact({ applicationId: id })
    ).toMatchObject({ ok: true, status: "in_contact" });
    expect(
      await h
        .as(coord)
        .recordAdoptionOutcome({ applicationId: id, outcome: "adopted" })
    ).toEqual({
      ok: true,
      status: "adopted",
      slug: world.animal.slug,
      directoryListingId: world.rep.listingId,
    });

    expect(
      (await applicationAudit(h, id)).map(({ action, before, after }) => [
        action,
        before,
        after,
      ])
    ).toEqual([
      ["adoption.application_submitted", null, expect.any(Object)],
      [
        "adoption.application_status_changed",
        { status: "submitted" },
        { status: "under_review" },
      ],
      [
        "adoption.application_status_changed",
        { status: "under_review" },
        { status: "in_contact" },
      ],
      ["adoption.contact_shared", null, { contactShared: true }],
      [
        "adoption.application_status_changed",
        { status: "in_contact" },
        { status: "adopted" },
      ],
    ]);
    expect(
      await h.as(world.applicant.actor).myAdoptionApplications()
    ).toMatchObject([{ id, status: "adopted" }]);
  });

  it("needs a reason to record not matched or to decline, keeps it for staff and closes the application", async () => {
    const h = await createHarness();
    const world = await adoptionWorld(h);
    const id = await applied(h, world);
    const coord = await coordinator(h);
    await h.as(coord).startAdoptionReview({ applicationId: id });

    expect(
      await h
        .as(coord)
        .recordAdoptionOutcome({ applicationId: id, outcome: "not_matched" })
    ).toEqual({ ok: false, error: "reason_required" });
    expect(
      await h.as(coord).recordAdoptionOutcome({
        applicationId: id,
        outcome: "not_matched",
        reason: "  The family moves abroad in March.  ",
      })
    ).toMatchObject({ ok: true, status: "not_matched" });

    expect(
      await h.as(coord).getAdoptionApplication({ applicationId: id })
    ).toMatchObject({
      status: "not_matched",
      outcomeReason: "The family moves abroad in March.",
    });
    const row = await applicationRow(h, id);
    expect(row?.outcomeReasonCiphertext).not.toContain("abroad");
    expect(row?.closedAt).toEqual(h.clock.now());
    // The applicant never reads the coordinator's words.
    expect(
      JSON.stringify(
        await h
          .as(world.applicant.actor)
          .myAdoptionApplication({ applicationId: id })
      )
    ).not.toContain("abroad");
  });

  it("declines straight from submitted, with a reason", async () => {
    const h = await createHarness();
    const world = await adoptionWorld(h);
    const id = await applied(h, world);

    expect(
      await h.as(await coordinator(h)).recordAdoptionOutcome({
        applicationId: id,
        outcome: "declined",
        reason: "Answers suggest a working dog is needed.",
      })
    ).toMatchObject({ ok: true, status: "declined" });
  });

  it("refuses moves the table forbids: contact before review, adopted before contact, anything after an ending", async () => {
    const h = await createHarness();
    const world = await adoptionWorld(h);
    const id = await applied(h, world);
    const coord = await coordinator(h);

    expect(
      await h.as(coord).putAdopterInContact({ applicationId: id })
    ).toEqual({ ok: false, error: "invalid_transition" });
    await h.as(coord).startAdoptionReview({ applicationId: id });
    expect(
      await h
        .as(coord)
        .recordAdoptionOutcome({ applicationId: id, outcome: "adopted" })
    ).toEqual({ ok: false, error: "invalid_transition" });
    await h
      .as(world.applicant.actor)
      .withdrawAdoptionApplication({ applicationId: id });
    expect(
      await h.as(coord).startAdoptionReview({ applicationId: id })
    ).toEqual({ ok: false, error: "invalid_transition" });
  });

  it("refuses a representative, a member, a staff admin and a visitor moving an application", async () => {
    const h = await createHarness();
    const world = await adoptionWorld(h);
    const id = await applied(h, world);

    for (const actor of [
      world.rep.actor,
      world.applicant.actor,
      await member(h),
      await staffAdmin(h),
      h.visitor(),
    ]) {
      await expect(
        h.as(actor).startAdoptionReview({ applicationId: id })
      ).rejects.toThrow(DomainError);
      await expect(
        h.as(actor).getAdoptionApplication({ applicationId: id })
      ).rejects.toThrow(DomainError);
      await expect(h.as(actor).listAdoptionApplications()).rejects.toThrow(
        DomainError
      );
    }
    expect(await applicationRow(h, id)).toMatchObject({ status: "submitted" });
  });

  it("refuses a coordinator who hasn't passed their second factor", async () => {
    const h = await createHarness();
    const world = await adoptionWorld(h);
    const id = await applied(h, world);
    const account = await h.seed.member();
    await h.seed.grant(account, {
      role: "adoption_coordinator",
      scope: { type: "global" },
    });
    await h.seed.authenticator(account);
    const halfSignedIn = await h.signIn(account, undefined, {
      secondFactor: false,
    });

    await expect(
      h.as(halfSignedIn).startAdoptionReview({ applicationId: id })
    ).rejects.toMatchObject({ code: "second_factor_required" });
  });

  it("lets an organisation-scoped coordinator act only on that organisation's animals", async () => {
    const h = await createHarness();
    const world = await adoptionWorld(h);
    const id = await applied(h, world);
    const other = await representative(h, "verified", { name: "Cat Haven" });
    const otherAnimal = await published(h, other, { name: "Mithai" });
    h.clock.advance({ minutes: 1 });
    const otherId = await applied(h, world, world.applicant, {
      slug: otherAnimal.slug,
    });
    const scoped = await coordinator(h, {
      type: "organisation",
      id: world.rep.listingId,
    });

    expect(
      (await h.as(scoped).listAdoptionApplications()) as { id: string }[]
    ).toMatchObject([{ id }]);
    expect(
      await h.as(scoped).startAdoptionReview({ applicationId: id })
    ).toMatchObject({ ok: true });
    await expect(
      h.as(scoped).startAdoptionReview({ applicationId: otherId })
    ).rejects.toThrow(DomainError);
    expect(
      (
        (await h.as(await coordinator(h)).listAdoptionApplications()) as {
          id: string;
        }[]
      ).map((each) => each.id)
    ).toEqual([id, otherId]);
  });

  it("lists the queue oldest first, open by default or by status, with the applicant's name", async () => {
    const h = await createHarness();
    const world = await adoptionWorld(h);
    const id = await applied(h, world);
    const coord = await coordinator(h);

    expect(await h.as(coord).listAdoptionApplications()).toMatchObject([
      {
        id,
        status: "submitted",
        animal: { name: "Bruno" },
        organisation: { name: "Paws Pune" },
        applicant: { name: "Meera Iyer" },
      },
    ]);
    expect(
      await h.as(coord).listAdoptionApplications({ status: "adopted" })
    ).toEqual([]);
    expect(
      await h.as(coord).listAdoptionApplications({ status: "nonsense" })
    ).toMatchObject({ ok: false, error: "invalid_input" });
  });
});

describe("what the listing organisation sees", () => {
  it("sees status only before in_contact, then the applicant's name and contact, with the share audited", async () => {
    const h = await createHarness();
    const world = await adoptionWorld(h);
    const id = await applied(h, world);
    const coord = await coordinator(h);
    const read = () =>
      h.as(world.rep.actor).listApplicationsForAdoptionListing({
        adoptionListingId: world.animal.adoptionListingId,
      });

    expect(await read()).toEqual({
      ok: true,
      animal: { id: world.animal.adoptionListingId, name: "Bruno" },
      applications: [
        {
          id,
          status: "submitted",
          createdAt: h.clock.now(),
          updatedAt: h.clock.now(),
          applicant: null,
        },
      ],
    });
    await h.as(coord).startAdoptionReview({ applicationId: id });
    expect(await read()).toMatchObject({
      applications: [{ status: "under_review", applicant: null }],
    });

    await h.as(coord).putAdopterInContact({ applicationId: id });
    expect(await read()).toMatchObject({
      applications: [
        {
          status: "in_contact",
          applicant: {
            name: "Meera Iyer",
            phone: "+919876543210",
            address: "Flat 4, Sunrise Apartments, Koregaon Park, Pune 411001",
            answers: { homeType: "flat" },
          },
        },
      ],
    });
    expect(
      (await applicationAudit(h, id)).some(
        (entry) => entry.action === "adoption.contact_shared"
      )
    ).toBe(true);
  });

  it("stops showing the contact after a not-matched ending", async () => {
    const h = await createHarness();
    const world = await adoptionWorld(h);
    const id = await applied(h, world);
    const coord = await coordinator(h);
    await inContact(h, coord, id);
    await h.as(coord).recordAdoptionOutcome({
      applicationId: id,
      outcome: "not_matched",
      reason: "Did not answer calls.",
    });

    expect(
      await h.as(world.rep.actor).listApplicationsForAdoptionListing({
        adoptionListingId: world.animal.adoptionListingId,
      })
    ).toMatchObject({
      applications: [{ status: "not_matched", applicant: null }],
    });
  });

  it("refuses another organisation's representative, a member, a coordinator and a visitor", async () => {
    const h = await createHarness();
    const world = await adoptionWorld(h);
    await applied(h, world);
    const other = await representative(h, "verified", { name: "Cat Haven" });

    for (const actor of [
      other.actor,
      world.applicant.actor,
      await coordinator(h),
      h.visitor(),
    ]) {
      await expect(
        h.as(actor).listApplicationsForAdoptionListing({
          adoptionListingId: world.animal.adoptionListingId,
        })
      ).rejects.toThrow(DomainError);
    }
  });
});

describe("an adoption closes the listing", () => {
  it("marks the animal adopted, closes every other open application and takes it out of browse", async () => {
    const h = await createHarness();
    const world = await adoptionWorld(h);
    const winner = await applied(h, world);
    const otherAccount = await h.seed.member({
      name: "Kabir Shah",
      email: "kabir@example.test",
    });
    const other = { actor: await h.signIn(otherAccount) };
    const loser = await applied(h, world, other);
    const coord = await coordinator(h);
    await h.as(coord).startAdoptionReview({ applicationId: loser });

    await adopted(h, coord, winner);

    expect(await applicationRow(h, loser)).toMatchObject({
      status: "listing_closed",
      closedAt: h.clock.now(),
    });
    expect(
      await h.as(world.rep.actor).getAdoptionListingForOwner({
        adoptionListingId: world.animal.adoptionListingId,
      })
    ).toMatchObject({ ok: true, listing: { status: "adopted" } });
    const browse = await h.as(h.visitor()).browseAdoptableAnimals();
    expect(JSON.stringify(browse)).not.toContain(world.animal.slug);
    expect(
      await h
        .as(world.applicant.actor)
        .adoptionApplicationForm({ slug: world.animal.slug })
    ).toEqual({ ok: false, error: "listing_not_open" });
  });

  it("closes the open applications when the representative withdraws the listing", async () => {
    const h = await createHarness();
    const world = await adoptionWorld(h);
    const id = await applied(h, world);

    await h.as(world.rep.actor).withdrawAdoptionListing({
      adoptionListingId: world.animal.adoptionListingId,
    });

    expect(await applicationRow(h, id)).toMatchObject({
      status: "listing_closed",
    });
  });

  it("refuses an adoption when the listing can no longer be adopted, changing nothing", async () => {
    const h = await createHarness();
    const world = await adoptionWorld(h);
    const id = await applied(h, world);
    const coord = await coordinator(h);
    await inContact(h, coord, id);
    // A listing withdrawn under it would have closed the application; a
    // row moved by hand stands in for a listing that isn't adoptable.
    await h.db
      .update(adoptionListing)
      .set({ status: "draft" })
      .where(eq(adoptionListing.id, world.animal.adoptionListingId));

    expect(
      await h
        .as(coord)
        .recordAdoptionOutcome({ applicationId: id, outcome: "adopted" })
    ).toEqual({ ok: false, error: "listing_not_open" });
    expect(await applicationRow(h, id)).toMatchObject({ status: "in_contact" });
  });
});
