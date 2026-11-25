import { asc, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { adoptionApplication, user } from "@/server/db/schema";
import { createHarness } from "@/test/harness";

import { SEED_ADOPTION } from "./adoption";
import { SEED_ADOPTION_APPLICATIONS } from "./adoption-applications";

describe("the adoption applications' preview seed", () => {
  it("makes a submitted, an in-contact and an adopted application with a published story, the same the second time", async () => {
    const h = await createHarness();
    await h.seed.preview();
    const snapshot = () =>
      h.db
        .select({
          id: adoptionApplication.id,
          status: adoptionApplication.status,
          listingId: adoptionApplication.adoptionListingId,
        })
        .from(adoptionApplication)
        .orderBy(asc(adoptionApplication.id));
    const first = await snapshot();
    h.clock.advance({ days: 1 });
    await h.seed.preview();

    expect(first).toEqual([
      {
        id: SEED_ADOPTION_APPLICATIONS.submitted.applicationId,
        status: "submitted",
        listingId: SEED_ADOPTION.publishedId,
      },
      {
        id: SEED_ADOPTION_APPLICATIONS.inContact.applicationId,
        status: "in_contact",
        listingId: SEED_ADOPTION.raniId,
      },
      {
        id: SEED_ADOPTION_APPLICATIONS.adopted.applicationId,
        status: "adopted",
        listingId: SEED_ADOPTION.adoptedId,
      },
    ]);
    expect(await snapshot()).toEqual(first);
    expect(await h.as(h.visitor()).listPublishedSuccessStories()).toEqual([
      expect.objectContaining({
        id: SEED_ADOPTION_APPLICATIONS.adopted.storyId,
        animal: { name: "Seed Moti", species: "cat" },
      }),
    ]);
  });

  it("lets the seeded coordinator read the queue, oldest first, with the in-contact applicant's phone", async () => {
    const h = await createHarness();
    await h.seed.preview();
    const [coordinator] = await h.db
      .select()
      .from(user)
      .where(eq(user.email, SEED_ADOPTION_APPLICATIONS.coordinator.email));
    const coordinatorActor = await h.signIn({
      ...coordinator!,
      email: SEED_ADOPTION_APPLICATIONS.coordinator.email,
    });

    expect(
      await h.as(coordinatorActor).listAdoptionApplications()
    ).toMatchObject([
      { id: SEED_ADOPTION_APPLICATIONS.inContact.applicationId },
      { id: SEED_ADOPTION_APPLICATIONS.submitted.applicationId },
    ]);
    expect(
      await h.as(coordinatorActor).getAdoptionApplication({
        applicationId: SEED_ADOPTION_APPLICATIONS.inContact.applicationId,
      })
    ).toMatchObject({
      status: "in_contact",
      details: { phone: "+919812300002" },
    });
  });
});
