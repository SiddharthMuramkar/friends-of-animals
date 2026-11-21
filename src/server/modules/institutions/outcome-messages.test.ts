import { describe, expect, it } from "vitest";

import { createHarness } from "@/test/harness";

import { registeredInstitution, signedInStaff } from "./testing";

describe("the authorised person hears each decision", () => {
  it("is told by email and in the inbox that the institution is verified, with its Institution ID", async () => {
    const h = await createHarness();
    const { person, actor, institutionId } = await registeredInstitution(h, {
      name: "Sunrise Public School",
    });
    const staff = await signedInStaff(h);

    const decided = await h.as(staff).decideInstitution({
      institutionId,
      decision: "verify",
      reason: "Checked with the principal by phone.",
    });
    if (!decided.ok) throw new Error(`verify refused: ${decided.error}`);
    await h.drain();

    const subject = "Sunrise Public School is verified";
    const email = h.email.lastTo(person.email);
    expect(email?.subject).toBe(subject);
    expect(email?.text).toContain(decided.institutionCode);
    expect(h.email.sent.filter((m) => m.subject === subject)).toHaveLength(1);
    expect(await h.as(actor).listInbox()).toEqual([
      expect.objectContaining({
        title: subject,
        body: expect.stringContaining(decided.institutionCode!),
      }),
    ]);
  });

  it("is told by email and in the inbox that FOA couldn't accept the institution", async () => {
    const h = await createHarness();
    const { person, actor, institutionId } = await registeredInstitution(h, {
      name: "Sunrise Public School",
    });
    const staff = await signedInStaff(h);

    await h.as(staff).decideInstitution({
      institutionId,
      decision: "reject",
      reason: "The school's registration number didn't match.",
    });
    await h.drain();

    const subject = "FOA couldn't accept Sunrise Public School";
    expect(h.email.lastTo(person.email)?.subject).toBe(subject);
    expect(h.email.sent.filter((m) => m.subject === subject)).toHaveLength(1);
    expect(await h.as(actor).listInbox()).toEqual([
      expect.objectContaining({ title: subject }),
    ]);
  });

  it("is told by email and in the inbox that a verified institution is suspended", async () => {
    const h = await createHarness();
    const { person, actor, institutionId } = await registeredInstitution(h, {
      name: "Sunrise Public School",
    });
    const staff = await signedInStaff(h);
    await h.as(staff).decideInstitution({
      institutionId,
      decision: "verify",
      reason: "Checked with the principal by phone.",
    });
    await h.drain();
    h.clock.advance({ hours: 1 });

    await h.as(staff).decideInstitution({
      institutionId,
      decision: "suspend",
      reason: "The principal asked us to pause it.",
    });
    await h.drain();

    const subject = "Sunrise Public School is suspended";
    expect(h.email.lastTo(person.email)?.subject).toBe(subject);
    expect(h.email.sent.filter((m) => m.subject === subject)).toHaveLength(1);
    const inbox = await h.as(actor).listInbox();
    expect(inbox.map((item) => item.title)).toEqual([
      subject,
      "Sunrise Public School is verified",
    ]);
  });

  it("is told by email and in the inbox that a suspended institution is verified again, with the Institution ID it kept", async () => {
    const h = await createHarness();
    const { person, actor, institutionId } = await registeredInstitution(h, {
      name: "Sunrise Public School",
    });
    const staff = await signedInStaff(h);
    const verified = await h.as(staff).decideInstitution({
      institutionId,
      decision: "verify",
      reason: "Checked with the principal by phone.",
    });
    if (!verified.ok) throw new Error(`verify refused: ${verified.error}`);
    h.clock.advance({ hours: 1 });
    await h.as(staff).decideInstitution({
      institutionId,
      decision: "suspend",
      reason: "The principal asked us to pause it.",
    });
    h.clock.advance({ hours: 1 });

    await h.as(staff).decideInstitution({
      institutionId,
      decision: "verify",
      reason: "The principal asked us to go on.",
    });
    await h.drain();

    const subject = "Sunrise Public School is verified again";
    const email = h.email.lastTo(person.email);
    expect(email?.subject).toBe(subject);
    expect(email?.text).toContain(verified.institutionCode);
    expect(h.email.sent.filter((m) => m.subject === subject)).toHaveLength(1);
    // These decisions were drained together, so their inbox delivery times can tie.
    const inbox = await h.as(actor).listInbox();
    expect(inbox).toHaveLength(3);
    expect(inbox.filter((item) => item.title === subject)).toEqual([
      expect.objectContaining({
        body: expect.stringContaining(verified.institutionCode!),
      }),
    ]);
  });

  it("hears nothing about a decision FOA's rules refused", async () => {
    const h = await createHarness();
    const { actor, institutionId } = await registeredInstitution(h);
    const staff = await signedInStaff(h);
    const emailsBefore = h.email.sent.length;

    const blank = await h.as(staff).decideInstitution({
      institutionId,
      decision: "reject",
      reason: "   ",
    });
    const notAllowed = await h.as(staff).decideInstitution({
      institutionId,
      decision: "suspend",
      reason: "Only a verified institution can be suspended.",
    });
    await h.drain();

    expect([blank, notAllowed]).toEqual([
      { ok: false, error: "reason_required" },
      { ok: false, error: "transition_not_allowed" },
    ]);
    expect(h.email.sent.slice(emailsBefore)).toEqual([]);
    expect(await h.as(actor).listInbox()).toEqual([]);
  });
});
