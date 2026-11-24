import { describe, expect, it } from "vitest";

import { createHarness } from "@/test/harness";

import { registeredListing, signedInStaff, verifiedListing } from "./testing";

describe("the person who registered a listing hears each decision", () => {
  it("is told by email and in the inbox that the listing is verified, with FOA's note", async () => {
    const h = await createHarness();
    const { person, actor, listingId } = await registeredListing(h);
    const staff = await signedInStaff(h);

    await h.as(staff).verifyListing({
      listingId,
      reason: "Checked the trust deed by phone.",
    });
    await h.drain();

    const subject = "Paws Trust is on FOA's directory";
    const email = h.email.lastTo(person.email);
    expect(email?.subject).toBe(subject);
    expect(email?.text).toContain("Checked the trust deed by phone.");
    expect(h.email.sent.filter((m) => m.subject === subject)).toHaveLength(1);
    expect(await h.as(actor).listInbox()).toEqual([
      expect.objectContaining({
        title: subject,
        body: expect.stringContaining("Checked the trust deed by phone."),
      }),
    ]);
  });

  it("is told that FOA couldn't accept it, and why", async () => {
    const h = await createHarness();
    const { person, listingId } = await registeredListing(h);
    const staff = await signedInStaff(h);

    await h.as(staff).rejectListing({
      listingId,
      reason: "The registration number didn't match.",
    });
    await h.drain();

    const email = h.email.lastTo(person.email);
    expect(email?.subject).toBe("FOA couldn't accept Paws Trust");
    expect(email?.text).toContain("The registration number didn't match.");
  });

  it("is told when it is suspended and when it is back", async () => {
    const h = await createHarness();
    const { person, actor, listingId, staff } = await verifiedListing(h);
    await h.drain();

    await h
      .as(staff)
      .suspendListing({ listingId, reason: "Complaints about the helpline." });
    await h.drain();
    expect(h.email.lastTo(person.email)?.subject).toBe(
      "Paws Trust is hidden from FOA's directory"
    );

    await h
      .as(staff)
      .reinstateListing({ listingId, reason: "The helpline works again." });
    await h.drain();
    expect(h.email.lastTo(person.email)?.subject).toBe(
      "Paws Trust is back on FOA's directory"
    );
    expect(
      (await h.as(actor).listInbox()).map((item) => item.title)
    ).toEqual(
      expect.arrayContaining([
        "Paws Trust is on FOA's directory",
        "Paws Trust is hidden from FOA's directory",
        "Paws Trust is back on FOA's directory",
      ])
    );
  });

  it("sends nothing for a registration: staff find it in their queue", async () => {
    const h = await createHarness();
    const { actor } = await registeredListing(h);

    await h.drain();

    expect(
      h.email.sent.filter((m) => m.text.includes("Paws Trust"))
    ).toEqual([]);
    expect(await h.as(actor).listInbox()).toEqual([]);
  });
});
