import { describe, expect, it } from "vitest";

import { createHarness, type Harness } from "@/test/harness";

import {
  adultApplication,
  openVolunteering,
  staffActor,
  teenApplication,
} from "./testing";

// The messages a volunteer application sends (#123), through the real
// relay and dispatcher: drizzle/*_123_volunteer_messages.sql holds the
// routes and wording.

async function inboxTitles(h: Harness, actor: Parameters<Harness["as"]>[0]) {
  return (await h.as(actor).listInbox()).map((item) => item.title);
}

function emailsTo(h: Harness, to: string): string[] {
  return h.email.sent
    .filter((message) => message.to === to)
    .map((message) => message.subject);
}

describe("volunteer application messages", () => {
  it("asks a teen's verified guardian to approve, and never emails the teen", async () => {
    const h = await createHarness();
    const declarations = await openVolunteering(h);
    const { teen, guardian } = await teenApplication(h, declarations);

    await h.drain();

    const asked = h.email.lastTo("sunita@example.test");
    expect(asked?.subject).toBe(
      "Arjun Rao has applied to volunteer with Friends of Animals"
    );
    expect(asked?.text).toContain("Hello Sunita Rao,");
    expect(asked?.text).toContain("open Arjun Rao's page under My children");
    expect(await inboxTitles(h, guardian.actor)).toEqual([
      "Arjun Rao has applied to volunteer",
    ]);
    // Only the sign-in code the harness used.
    expect(
      emailsTo(h, "arjun@example.test").filter(
        (subject) => !subject.includes("sign-in code")
      )
    ).toEqual([]);
    expect(await inboxTitles(h, teen.actor)).toEqual([]);
  });

  it("tells an adult their application arrived, and the community team that it is waiting", async () => {
    const h = await createHarness();
    const declarations = await openVolunteering(h);
    const manager = await staffActor(h, "community_manager");
    const priya = await adultApplication(h, declarations);

    await h.drain();

    expect(h.email.lastTo("priya@example.test")?.subject).toBe(
      "We have your application to volunteer"
    );
    expect(await inboxTitles(h, priya.actor)).toEqual([
      "Your application to volunteer is with our community team",
    ]);
    expect(await inboxTitles(h, manager)).toEqual([
      "A volunteer application is waiting: Priya Nair",
    ]);
  });

  it("tells the applicant they are approved, or why not", async () => {
    const h = await createHarness();
    const declarations = await openVolunteering(h);
    const manager = await staffActor(h, "community_manager");
    const priya = await adultApplication(h, declarations);
    const ravi = await adultApplication(h, declarations, {
      name: "Ravi Kumar",
      email: "ravi@example.test",
    });
    await h.drain();

    await h
      .as(manager)
      .approveVolunteer({ applicationId: priya.applicationId });
    await h.as(manager).declineVolunteer({
      applicationId: ravi.applicationId,
      reason: "We have no openings in your city yet.",
    });
    await h.drain();

    expect(h.email.lastTo("priya@example.test")?.subject).toBe(
      "Welcome to the Friends of Animals volunteers"
    );
    const declined = h.email.lastTo("ravi@example.test");
    expect(declined?.subject).toBe("Your application to volunteer");
    expect(declined?.text).toContain(
      "Why: We have no openings in your city yet."
    );
    expect(await inboxTitles(h, ravi.actor)).toContain(
      "Your application to volunteer was declined"
    );
  });

  it("writes to a teen's guardians about the decision, and gives the teen an inbox copy only", async () => {
    const h = await createHarness();
    const declarations = await openVolunteering(h);
    const manager = await staffActor(h, "community_manager");
    const { teen, guardian, applicationId } = await teenApplication(
      h,
      declarations
    );
    await h
      .as(guardian.actor)
      .decideAsGuardian({ applicationId, decision: "approve" });
    await h.drain();
    await h.as(manager).approveVolunteer({ applicationId });
    await h.drain();

    expect(h.email.lastTo("sunita@example.test")?.subject).toBe(
      "Arjun Rao is now a Friends of Animals volunteer"
    );
    expect(
      emailsTo(h, "arjun@example.test").filter(
        (subject) => !subject.includes("sign-in code")
      )
    ).toEqual([]);
    expect(await inboxTitles(h, teen.actor)).toEqual(
      expect.arrayContaining([
        "Your application to volunteer is with our community team",
        "Your application to volunteer is approved",
      ])
    );
    expect(await inboxTitles(h, guardian.actor)).toContain(
      "Arjun Rao's application to volunteer is approved"
    );
  });
});
