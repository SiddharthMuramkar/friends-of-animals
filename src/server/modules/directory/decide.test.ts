import { count, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { auditLog, directoryListing, userRole } from "@/server/db/schema";
import { DomainError } from "@/server/errors";
import { createHarness, type Harness } from "@/test/harness";

import { registeredListing, signedInStaff, verifiedListing } from "./testing";

const REASON = "Checked the trust deed and the AWBI letter.";

async function rowsFor(h: Harness, listingId: string) {
  const [listing] = await h.db
    .select({ status: directoryListing.status })
    .from(directoryListing)
    .where(eq(directoryListing.id, listingId));
  const [audits] = await h.db
    .select({ n: count() })
    .from(auditLog)
    .where(eq(auditLog.entityId, listingId));
  return { status: listing?.status, audits: audits?.n };
}

describe("verifyListing", () => {
  it("puts the listing on the public directory and makes its registrant its representative", async () => {
    const h = await createHarness();
    const { listingId, slug, person, actor } = await registeredListing(h);
    const staff = await signedInStaff(h);

    const result = await h
      .as(staff)
      .verifyListing({ listingId, reason: `  ${REASON}  ` });

    expect(result).toEqual({
      ok: true,
      outcome: "verified",
      status: "verified",
      slug,
    });
    expect(await h.as(h.visitor()).getPublicListing({ slug })).toMatchObject({
      ok: true,
      listing: { name: "Paws Trust" },
    });
    const { grants } = await h.as(actor).myAccess();
    expect(grants).toContainEqual({
      role: "organisation_representative",
      scope: { type: "organisation", id: listingId },
    });
    expect(await h.as(actor).getMyListing({ listingId })).toMatchObject({
      ok: true,
      listing: { status: "verified", statusReason: REASON },
    });
    const [audit] = await h.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, "directory.listing_verified"));
    expect(audit).toMatchObject({
      entityType: "directory_listing",
      entityId: listingId,
      actorRole: "staff_admin",
      before: { status: "pending_verification", reason: null },
      after: { status: "verified", reason: REASON, representative: person.id },
    });
    expect(JSON.stringify(audit)).not.toContain("Koregaon");
  });

  it("lets a super admin verify too", async () => {
    const h = await createHarness();
    const { listingId } = await registeredListing(h);
    const admin = await signedInStaff(h, "super_admin");

    expect(
      await h.as(admin).verifyListing({ listingId, reason: REASON })
    ).toMatchObject({ ok: true, status: "verified" });
  });

  it("answers not found for a listing that doesn't exist", async () => {
    const h = await createHarness();
    const staff = await signedInStaff(h);

    expect(
      await h.as(staff).verifyListing({
        listingId: "01938a00-0000-7000-8000-00000000dead",
        reason: REASON,
      })
    ).toEqual({ ok: false, error: "not_found" });
  });
});

describe("rejectListing, suspendListing and reinstateListing", () => {
  it("rejects a pending listing for good, keeping it private", async () => {
    const h = await createHarness();
    const { listingId, slug, actor } = await registeredListing(h);
    const staff = await signedInStaff(h);

    expect(
      await h.as(staff).rejectListing({
        listingId,
        reason: "The registration number didn't match.",
      })
    ).toMatchObject({ ok: true, outcome: "rejected", status: "rejected" });
    expect(await h.as(h.visitor()).getPublicListing({ slug })).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(await h.as(actor).listMyListings()).toEqual([
      expect.objectContaining({
        status: "rejected",
        statusReason: "The registration number didn't match.",
        canEdit: false,
        canWithdraw: false,
      }),
    ]);
    expect(
      await h.as(staff).verifyListing({ listingId, reason: REASON })
    ).toEqual({ ok: false, error: "transition_not_allowed" });
    expect(await rowsFor(h, listingId)).toEqual({
      status: "rejected",
      audits: 2,
    });
  });

  it("hides a suspended listing and shows it again once reinstated, with one representative grant", async () => {
    const h = await createHarness();
    const { listingId, slug, person, staff } = await verifiedListing(h);

    expect(
      await h.as(staff).suspendListing({
        listingId,
        reason: "Complaints about the helpline.",
      })
    ).toMatchObject({ ok: true, outcome: "suspended", status: "suspended" });
    expect(await h.as(h.visitor()).getPublicListing({ slug })).toEqual({
      ok: false,
      error: "not_found",
    });

    expect(
      await h
        .as(staff)
        .reinstateListing({ listingId, reason: "The helpline works again." })
    ).toMatchObject({ ok: true, outcome: "reinstated", status: "verified" });
    expect(await h.as(h.visitor()).getPublicListing({ slug })).toMatchObject({
      ok: true,
    });
    const [grants] = await h.db
      .select({ n: count() })
      .from(userRole)
      .where(eq(userRole.userId, person.id));
    expect(grants?.n).toBe(1);
  });

  it("doesn't give a revoked representative the role back when the listing is verified again", async () => {
    const h = await createHarness();
    const { listingId, person, staff } = await verifiedListing(h);
    // A second representative, granted by a super admin, renames it.
    const admin = await h.signIn(await h.seed.superAdmin());
    const colleague = await h.seed.member();
    const representative = {
      role: "organisation_representative",
      scope: { type: "organisation", id: listingId },
    } as const;
    await h.as(admin).grantRole({ userId: colleague.id, ...representative });
    await h.as(admin).revokeRole({ userId: person.id, ...representative });
    const mine = await h
      .as(await h.signIn(colleague))
      .getMyListing({ listingId });
    if (!mine.ok) throw new Error("The colleague can't read the listing");
    const renamed = await h.as(await h.signIn(colleague)).updateListing({
      ...mine.listing,
      contactEmail: mine.listing.contactEmail ?? "",
      website: mine.listing.website ?? "",
      listingId,
      name: "Paws Trust Pune",
    });
    expect(renamed).toMatchObject({ ok: true, status: "pending_verification" });

    expect(
      await h.as(staff).verifyListing({ listingId, reason: REASON })
    ).toMatchObject({ ok: true, status: "verified" });

    const { grants } = await h.as(await h.signIn(person)).myAccess();
    expect(grants).not.toContainEqual(representative);
  });

  it.each([
    ["verifyListing", "pending"],
    ["rejectListing", "pending"],
    ["suspendListing", "verified"],
    ["reinstateListing", "suspended"],
  ] as const)(
    "%s needs a reason of at most 1,000 characters and writes nothing without one",
    async (useCase, from) => {
      const h = await createHarness();
      const { listingId, staff } =
        from === "pending"
          ? { ...(await registeredListing(h)), staff: await signedInStaff(h) }
          : await verifiedListing(h);
      if (from === "suspended") {
        await h.as(staff).suspendListing({ listingId, reason: REASON });
      }
      const before = await rowsFor(h, listingId);

      for (const [reason, error] of [
        ["", "reason_required"],
        ["   \n ", "reason_required"],
        ["x".repeat(1001), "reason_too_long"],
      ] as const) {
        expect(await h.as(staff)[useCase]({ listingId, reason })).toEqual({
          ok: false,
          error,
        });
      }
      expect(await rowsFor(h, listingId)).toEqual(before);
    }
  );
});

describe("who may decide", () => {
  it.each(["verifyListing", "rejectListing"] as const)(
    "%s refuses a community manager, a member and the listing's own registrant",
    async (useCase) => {
      const h = await createHarness();
      const { listingId, actor } = await registeredListing(h);
      const refused = [
        await signedInStaff(h, "community_manager"),
        await h.signIn(await h.seed.member()),
        actor,
        h.visitor(),
      ];

      for (const who of refused) {
        await expect(
          h.as(who)[useCase]({ listingId, reason: REASON })
        ).rejects.toThrow(DomainError);
      }
      expect(await rowsFor(h, listingId)).toEqual({
        status: "pending_verification",
        audits: 1,
      });
    }
  );

  it.each(["suspendListing", "reinstateListing"] as const)(
    "%s refuses the listing's own representative",
    async (useCase) => {
      const h = await createHarness();
      const { listingId, actor } = await verifiedListing(h);

      await expect(
        h.as(actor)[useCase]({ listingId, reason: REASON })
      ).rejects.toThrow(DomainError);
      expect((await rowsFor(h, listingId)).status).toBe("verified");
    }
  );
});
