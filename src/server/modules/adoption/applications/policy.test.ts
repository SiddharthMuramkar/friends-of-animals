import { describe, expect, it } from "vitest";

import { DomainError } from "@/server/errors";
import { createHarness } from "@/test/harness";

import { member, staffAdmin } from "../testing";
import { adoptionWorld, applied, coordinator } from "./testing";

// The refusals the other files don't cover use case by use case: every
// coordinator move refuses everyone but a coordinator, and reading one's
// own applications needs a signed-in user.

describe("who may move an adoption application on", () => {
  it("lets only a coordinator put an applicant in touch or record an outcome", async () => {
    const h = await createHarness();
    const world = await adoptionWorld(h);
    const id = await applied(h, world);
    const coord = await coordinator(h);
    await h.as(coord).startAdoptionReview({ applicationId: id });

    for (const actor of [
      world.rep.actor,
      world.applicant.actor,
      await member(h),
      await staffAdmin(h),
      h.visitor(),
    ]) {
      await expect(
        h.as(actor).putAdopterInContact({ applicationId: id })
      ).rejects.toThrow(DomainError);
      await expect(
        h.as(actor).recordAdoptionOutcome({
          applicationId: id,
          outcome: "declined",
          reason: "Not a good fit.",
        })
      ).rejects.toThrow(DomainError);
    }

    expect(
      await h.as(coord).putAdopterInContact({ applicationId: id })
    ).toMatchObject({ ok: true, status: "in_contact" });
    expect(
      await h
        .as(coord)
        .recordAdoptionOutcome({ applicationId: id, outcome: "adopted" })
    ).toMatchObject({ ok: true, status: "adopted" });
  });

  it("refuses a visitor their own applications list", async () => {
    const h = await createHarness();

    await expect(h.as(h.visitor()).myAdoptionApplications()).rejects.toThrow(
      DomainError
    );
  });

  it("lets anyone read the published stories", async () => {
    const h = await createHarness();

    expect(await h.as(h.visitor()).listPublishedSuccessStories()).toEqual([]);
  });
});
