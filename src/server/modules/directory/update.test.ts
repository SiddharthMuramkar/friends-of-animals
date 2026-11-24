import { and, count, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import type { Actor } from "@/server/actor";
import { auditLog, outbox } from "@/server/db/schema";
import { DomainError } from "@/server/errors";
import { createHarness, type Harness } from "@/test/harness";

import {
  registeredListing,
  signedInStaff,
  validListing,
  verifiedListing,
} from "./testing";

/** What the edit form sends back: the listing as it is, plus `changes`. */
async function edit(
  h: Harness,
  actor: Actor,
  listingId: string,
  changes: Record<string, unknown> = {}
) {
  return h
    .as(actor)
    .updateListing({ ...validListing(), ...changes, listingId });
}

async function auditsNamed(h: Harness, listingId: string, action: string) {
  return h.db
    .select({ before: auditLog.before, after: auditLog.after })
    .from(auditLog)
    .where(and(eq(auditLog.entityId, listingId), eq(auditLog.action, action)));
}

describe("updateListing", () => {
  it("lets the registrant change a pending listing, which stays pending", async () => {
    const h = await createHarness();
    const { listingId, actor } = await registeredListing(h);

    const result = await edit(h, actor, listingId, {
      name: "Paws Trust Pune",
      contactPhone: "+91 99999 00001",
    });

    expect(result).toEqual({
      ok: true,
      changed: true,
      resubmitted: false,
      status: "pending_verification",
      slug: "paws-trust",
    });
    expect(await h.as(actor).getMyListing({ listingId })).toMatchObject({
      ok: true,
      listing: { name: "Paws Trust Pune", contactPhone: "+919999900001" },
    });
    expect(await auditsNamed(h, listingId, "directory.listing_edited")).toEqual(
      [{ before: null, after: { fields: ["name", "contactPhone"] } }]
    );
  });

  it("puts a verified listing's detail edits live at once, naming the fields and never their values", async () => {
    const h = await createHarness();
    const { listingId, slug, actor } = await verifiedListing(h);

    const result = await edit(h, actor, listingId, {
      description: "Rescue and treatment, day and night.",
      publicContactFields: ["phone", "email"],
    });

    expect(result).toMatchObject({
      ok: true,
      changed: true,
      status: "verified",
    });
    expect(await h.as(h.visitor()).getPublicListing({ slug })).toMatchObject({
      ok: true,
      listing: {
        description: "Rescue and treatment, day and night.",
        contact: {
          phone: "+919876543210",
          email: "hello@pawstrust.example.test",
        },
      },
    });
    const audits = await auditsNamed(h, listingId, "directory.listing_edited");
    expect(audits).toEqual([
      {
        before: null,
        after: { fields: ["description", "publicContactFields"] },
      },
    ]);
    expect(JSON.stringify(audits)).not.toContain("day and night");
  });

  it.each([
    ["name", { name: "Paws Trust Pune" }],
    ["type", { type: "shelter" }],
  ] as const)(
    "sends a verified listing back to review when its %s changes",
    async (field, changes) => {
      const h = await createHarness();
      const { listingId, slug, actor, person } = await verifiedListing(h);

      expect(await edit(h, actor, listingId, changes)).toMatchObject({
        ok: true,
        changed: true,
        resubmitted: true,
        status: "pending_verification",
        slug,
      });
      expect(await h.as(h.visitor()).getPublicListing({ slug })).toEqual({
        ok: false,
        error: "not_found",
      });
      expect(
        await auditsNamed(h, listingId, "directory.listing_resubmitted")
      ).toEqual([
        {
          before: { status: "verified" },
          after: { fields: [field], status: "pending_verification" },
        },
      ]);
      const submitted = await h.db
        .select({ payload: outbox.payload })
        .from(outbox)
        .where(
          and(
            eq(outbox.aggregateId, listingId),
            eq(outbox.eventType, "directory.listing_submitted")
          )
        );
      expect(submitted).toHaveLength(2);
      expect(submitted[1]?.payload).toEqual({ listingId, userId: person.id });
    }
  );

  it("reports an unchanged listing as no change and writes nothing", async () => {
    const h = await createHarness();
    const { listingId, actor } = await verifiedListing(h);

    expect(
      await edit(h, actor, listingId, {
        services: ["rescue", "veterinary_care"],
      })
    ).toEqual({
      ok: true,
      changed: false,
      resubmitted: false,
      status: "verified",
      slug: "paws-trust",
    });
    expect(await auditsNamed(h, listingId, "directory.listing_edited")).toEqual(
      []
    );
  });

  it("names the fields it can't accept", async () => {
    const h = await createHarness();
    const { listingId, actor } = await registeredListing(h);

    expect(
      await edit(h, actor, listingId, { name: "", pinCode: "12345" })
    ).toEqual({
      ok: false,
      error: "invalid_input",
      fields: ["name", "pinCode"],
    });
  });

  it.each(["rejected", "suspended", "withdrawn"] as const)(
    "refuses to edit a %s listing",
    async (status) => {
      const h = await createHarness();
      const { listingId, actor } = await registeredListing(h);
      const staff = await signedInStaff(h);
      const reason = "Recorded by the test.";
      if (status === "rejected") {
        await h.as(staff).rejectListing({ listingId, reason });
      } else {
        await h.as(staff).verifyListing({ listingId, reason });
        if (status === "suspended") {
          await h.as(staff).suspendListing({ listingId, reason });
        } else {
          await h.as(actor).withdrawListing({ listingId });
        }
      }

      expect(
        await edit(h, actor, listingId, { description: "New words." })
      ).toEqual({ ok: false, error: "listing_not_editable" });
    }
  );
});

describe("who may act for a listing", () => {
  it("refuses another listing's representative, a member and a staff admin", async () => {
    const h = await createHarness();
    const a = await verifiedListing(h);
    const b = await verifiedListing(h, { name: "Safe Paws Shelter" });
    const refused = [
      a.actor,
      await h.signIn(await h.seed.member()),
      await signedInStaff(h),
      h.visitor(),
    ];

    for (const who of refused) {
      await expect(
        edit(h, who, b.listingId, { description: "Taken over." })
      ).rejects.toThrow(DomainError);
      await expect(
        h.as(who).getMyListing({ listingId: b.listingId })
      ).rejects.toThrow(DomainError);
      await expect(
        h.as(who).withdrawListing({ listingId: b.listingId })
      ).rejects.toThrow(DomainError);
    }
    expect(
      await h.as(b.actor).getMyListing({ listingId: b.listingId })
    ).toMatchObject({
      ok: true,
      listing: { description: "We rescue and treat street animals in Pune." },
    });
  });

  it("stops the registrant once their representative role is revoked", async () => {
    const h = await createHarness();
    const { listingId, person, actor } = await verifiedListing(h);
    const admin = await h.signIn(await h.seed.superAdmin());

    await h.as(admin).revokeRole({
      userId: person.id,
      role: "organisation_representative",
      scope: { type: "organisation", id: listingId },
    });

    await expect(
      edit(h, actor, listingId, { description: "Still mine?" })
    ).rejects.toThrow(DomainError);
    expect(await h.as(actor).listMyListings()).toEqual([]);
  });

  it("treats a listing that doesn't exist like one the actor may not touch", async () => {
    const h = await createHarness();
    const member = await h.signIn(await h.seed.member());

    await expect(
      h
        .as(member)
        .getMyListing({ listingId: "01938a00-0000-7000-8000-00000000dead" })
    ).rejects.toThrow(DomainError);
  });
});

describe("withdrawListing", () => {
  it("lets the registrant withdraw a pending listing, with an optional reason", async () => {
    const h = await createHarness();
    const { listingId, actor } = await registeredListing(h);

    expect(
      await h.as(actor).withdrawListing({
        listingId,
        reason: "  We merged with another trust. ",
      })
    ).toEqual({ ok: true, status: "withdrawn", slug: "paws-trust" });
    expect(await h.as(actor).listMyListings()).toEqual([
      expect.objectContaining({
        status: "withdrawn",
        statusReason: "We merged with another trust.",
        canEdit: false,
        canWithdraw: false,
      }),
    ]);
    expect(
      await auditsNamed(h, listingId, "directory.listing_withdrawn")
    ).toEqual([
      {
        before: { status: "pending_verification", reason: null },
        after: { status: "withdrawn", reason: "We merged with another trust." },
      },
    ]);
  });

  it("takes a verified listing off the public directory for good", async () => {
    const h = await createHarness();
    const { listingId, slug, actor, staff } = await verifiedListing(h);

    expect(await h.as(actor).withdrawListing({ listingId })).toMatchObject({
      ok: true,
    });
    expect(await h.as(h.visitor()).getPublicListing({ slug })).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(
      await h.as(staff).reinstateListing({ listingId, reason: "Back?" })
    ).toEqual({ ok: false, error: "transition_not_allowed" });
    expect(await h.as(actor).withdrawListing({ listingId })).toEqual({
      ok: false,
      error: "transition_not_allowed",
    });
  });

  it("refuses a reason over 1,000 characters and writes nothing", async () => {
    const h = await createHarness();
    const { listingId, actor } = await registeredListing(h);

    expect(
      await h.as(actor).withdrawListing({ listingId, reason: "x".repeat(1001) })
    ).toEqual({ ok: false, error: "reason_too_long" });
    const [audits] = await h.db
      .select({ n: count() })
      .from(auditLog)
      .where(eq(auditLog.entityId, listingId));
    expect(audits?.n).toBe(1);
  });
});
