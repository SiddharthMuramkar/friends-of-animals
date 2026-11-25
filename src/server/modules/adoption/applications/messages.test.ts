import { describe, expect, it } from "vitest";

import { createHarness } from "@/test/harness";

import {
  adoptionWorld,
  applied,
  coordinator,
  inboxTemplates,
  userIdOf,
} from "./testing";

describe("messages at each step", () => {
  it("tells the applicant and the organisation's representative once per step, and the coordinator when one arrives", async () => {
    const h = await createHarness();
    const world = await adoptionWorld(h);
    const coord = await coordinator(h);
    const applicantId = world.applicant.id;
    const repId = world.rep.owner.id;

    const id = await applied(h, world);
    await h.drain();
    expect(await inboxTemplates(h, applicantId)).toEqual([
      "adoption.application_received",
    ]);
    expect(await inboxTemplates(h, repId)).toEqual([
      "adoption.application_new.organisation",
    ]);
    expect(await inboxTemplates(h, userIdOf(coord))).toEqual([
      "adoption.application_to_review",
    ]);

    await h.drain();
    h.clock.advance({ minutes: 1 });
    await h.as(coord).startAdoptionReview({ applicationId: id });
    await h.drain();
    h.clock.advance({ minutes: 1 });
    await h.as(coord).putAdopterInContact({ applicationId: id });
    await h.drain();
    h.clock.advance({ minutes: 1 });
    await h
      .as(coord)
      .recordAdoptionOutcome({ applicationId: id, outcome: "adopted" });
    await h.drain();

    expect(await inboxTemplates(h, applicantId)).toEqual([
      "adoption.application_received",
      "adoption.application_under_review",
      "adoption.application_in_contact",
      "adoption.application_adopted",
    ]);
    expect(await inboxTemplates(h, repId)).toEqual([
      "adoption.application_new.organisation",
      "adoption.application_under_review.organisation",
      "adoption.application_in_contact.organisation",
      "adoption.application_adopted.organisation",
    ]);
    const emails = h.email.sent.filter(
      (each) =>
        each.to === "meera@example.test" && each.subject.includes("Bruno")
    );
    expect(emails.map((each) => each.subject)).toEqual([
      "We have your application to adopt Bruno",
      "We are reading your application to adopt Bruno",
      "Paws Pune will be in touch about Bruno",
      "Congratulations on adopting Bruno",
    ]);
  });

  it("never puts the applicant's name or contact in the organisation's messages", async () => {
    const h = await createHarness();
    const world = await adoptionWorld(h);
    const coord = await coordinator(h);
    const before = h.email.sent.length;
    const id = await applied(h, world);
    await h.as(coord).startAdoptionReview({ applicationId: id });
    await h.as(coord).putAdopterInContact({ applicationId: id });
    await h.drain();

    const toRep = h.email.sent
      .slice(before)
      .filter((each) => each.to === world.rep.owner.email);
    expect(toRep.length).toBe(3);
    for (const message of toRep) {
      expect(message.text).not.toContain("Meera");
      expect(message.text).not.toContain("98765");
      expect(message.text).not.toContain("Sunrise");
    }
  });

  it("tells each applicant once when the animal is adopted through someone else, and on withdrawals", async () => {
    const h = await createHarness();
    const world = await adoptionWorld(h);
    const coord = await coordinator(h);
    const winner = await applied(h, world);
    const otherAccount = await h.seed.member({
      name: "Kabir Shah",
      email: "kabir@example.test",
    });
    await applied(h, world, { actor: await h.signIn(otherAccount) });
    const third = await h.seed.member({
      name: "Asha Rao",
      email: "asha@example.test",
    });
    const thirdActor = await h.signIn(third);
    const withdrawn = await applied(h, world, { actor: thirdActor });
    await h.drain();
    h.clock.advance({ minutes: 1 });
    await h.as(thirdActor).withdrawAdoptionApplication({
      applicationId: withdrawn,
    });
    await h.drain();
    h.clock.advance({ minutes: 1 });
    await h.as(coord).startAdoptionReview({ applicationId: winner });
    await h.as(coord).putAdopterInContact({ applicationId: winner });
    await h
      .as(coord)
      .recordAdoptionOutcome({ applicationId: winner, outcome: "adopted" });
    await h.drain();

    expect(await inboxTemplates(h, otherAccount.id)).toEqual([
      "adoption.application_received",
      "adoption.application_listing_closed",
    ]);
    expect(await inboxTemplates(h, third.id)).toEqual([
      "adoption.application_received",
      "adoption.application_withdrawn",
    ]);
    expect(
      (await inboxTemplates(h, world.rep.owner.id)).filter(
        (key) => key === "adoption.application_withdrawn.organisation"
      )
    ).toHaveLength(1);
    expect(
      (await inboxTemplates(h, userIdOf(coord))).filter(
        (key) => key === "adoption.application_withdrawn.coordinators"
      )
    ).toHaveLength(1);
  });

  it("tells the applicant about a not-matched or declined ending without the coordinator's reason", async () => {
    const h = await createHarness();
    const world = await adoptionWorld(h);
    const coord = await coordinator(h);
    const id = await applied(h, world);
    await h.drain();
    h.clock.advance({ minutes: 1 });
    await h.as(coord).recordAdoptionOutcome({
      applicationId: id,
      outcome: "declined",
      reason: "Secret staff note about the home visit.",
    });
    await h.drain();

    expect(await inboxTemplates(h, world.applicant.id)).toEqual([
      "adoption.application_received",
      "adoption.application_declined",
    ]);
    expect((await inboxTemplates(h, world.rep.owner.id)).at(-1)).toBe(
      "adoption.application_declined.organisation"
    );
    for (const message of h.email.sent) {
      expect(message.text).not.toContain("Secret staff note");
    }
  });
});
