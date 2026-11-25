// #115b: an erasure is previewed, approved by its plan's fingerprint with a
// fresh second factor, and carried out by the worker: consents withdrawn,
// data deleted or anonymised, financial records kept under their floor, a
// legal hold respected, and an erasure record written. Running it again
// changes nothing.

import { and, asc, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  auditLog,
  consentEvent,
  entry,
  erasureRecord,
  fileAsset,
  participantProfile,
  paymentBatch,
  privacyRequest,
  registration,
  session,
  user,
} from "@/server/db/schema";
import { published } from "@/server/modules/adoption/testing";
import {
  validListing,
  verifiedListing,
} from "@/server/modules/directory/testing";
import { openToIndividuals } from "@/server/modules/participants/testing";
import { PROFILE_PURPOSE } from "@/server/modules/registration/student-profile";
import type { Actor } from "@/server/actor";
import { createHarness, type Harness } from "@/test/harness";

import { requestRows, signedInOfficer } from "../testing";
import { runExecuteErasure } from "./erasure";
import {
  ASHA,
  paidCompetition,
  participantWithEntry,
  withMessagesConsent,
  type Participant,
} from "./testing";

async function erasureFiled(h: Harness, who: Pick<Participant, "actor">) {
  const filed = await h
    .as(who.actor)
    .submitPrivacyRequest({ type: "erasure", subject: { kind: "self" } });
  if (!filed.ok) throw new Error(JSON.stringify(filed));
  const officer = await signedInOfficer(h);
  await h.as(officer.actor).startPrivacyRequest({ id: filed.requestId });
  await h.drain();
  return { ...filed, officer };
}

async function previewOf(h: Harness, officer: { actor: Actor }, id: string) {
  const result = await h.as(officer.actor).previewErasure({ id });
  if (!result.ok) throw new Error(JSON.stringify(result));
  return result.preview;
}

/** Approves the current plan and lets the worker carry it out. */
async function erase(
  h: Harness,
  filed: Awaited<ReturnType<typeof erasureFiled>>
) {
  const { plan } = await previewOf(h, filed.officer, filed.requestId);
  expect(
    await h.as(filed.officer.actor).executeErasure({
      id: filed.requestId,
      fingerprint: plan.fingerprint,
    })
  ).toEqual({ ok: true });
  await h.drain();
  return plan;
}

async function privateListingDocument(
  h: Harness,
  actor: Actor,
  listingId: string
) {
  const bytes = new TextEncoder().encode(
    "%PDF-1.7\n% Synthetic documentary proof\n%%EOF\n"
  );
  const upload = await h.as(actor).requestListingDocumentUpload({
    listingId,
    kind: "registration_certificate",
    contentType: "application/pdf",
    sizeBytes: bytes.length,
  });
  if (!upload.ok) throw new Error("Could not request document upload");
  await h.storage.put(upload.uploadUrl, bytes, upload.headers);
  expect(
    await h.as(actor).completeUpload({ fileId: upload.fileId })
  ).toMatchObject({ ok: true });
  await h.drain();
  return upload.documentId;
}

async function profileOf(h: Harness, id: string) {
  const [row] = await h.db
    .select()
    .from(participantProfile)
    .where(eq(participantProfile.id, id));
  return row;
}

describe("previewErasure", () => {
  it("lists what would go, what would be anonymised and what stays and why, and writes nothing", async () => {
    const h = await createHarness();
    const asha = await participantWithEntry(h, await paidCompetition(h), ASHA);
    await withMessagesConsent(h, asha);
    const filed = await erasureFiled(h, asha);
    const auditBefore = await h.db.select().from(auditLog);

    const preview = await previewOf(h, filed.officer, filed.requestId);

    expect(preview.enabled).toBe(false);
    expect(preview.plan.outcome).toBe("partially_completed");
    const decided = Object.fromEntries(
      preview.plan.categories.map((each) => [
        each.key,
        [each.action, each.basis],
      ])
    );
    expect(decided).toMatchObject({
      consents: ["withdraw", null],
      sign_in: ["delete", null],
      messages: ["delete", null],
      entries: ["delete", null],
      account: ["retain", "financial_floor"],
      kept_profile: ["anonymise", "financial_record"],
      paid_registrations: ["retain", "financial_record"],
      payments: ["retain", "financial_floor"],
      consent_records: ["retain", "consent_proof"],
      audit_log: ["retain", "audit_log"],
      privacy_requests: ["retain", "rights_record"],
    });
    // Paid in January 2027: the financial year ends 31 March 2027, and the
    // floor 8 years after that.
    const payments = preview.plan.categories.find(
      (each) => each.key === "payments"
    );
    expect(payments?.until).toEqual(new Date("2035-03-31T18:30:00.000Z"));
    expect(await h.db.select().from(auditLog)).toEqual(auditBefore);
    expect(await profileOf(h, asha.profileId)).toMatchObject({
      fullName: ASHA.name,
    });
  });

  it("is the grievance officer's alone", async () => {
    const h = await createHarness();
    const member = await h.signIn(await h.seed.member());
    const filed = await h
      .as(member)
      .submitPrivacyRequest({ type: "erasure", subject: { kind: "self" } });
    if (!filed.ok) throw new Error("expected a request");
    for (const role of ["staff_admin", "super_admin"] as const) {
      const account = await h.seed.member({ email: `${role}@example.test` });
      await h.seed.grant(account, { role, scope: { type: "global" } });
      const actor = await h.signIn(account);
      await expect(
        h.as(actor).previewErasure({ id: filed.requestId }),
        role
      ).rejects.toMatchObject({ name: "DomainError", code: "forbidden" });
      await expect(
        h
          .as(actor)
          .executeErasure({ id: filed.requestId, fingerprint: "0".repeat(32) }),
        role
      ).rejects.toMatchObject({ name: "DomainError", code: "forbidden" });
    }
    await expect(
      h.as(member).previewErasure({ id: filed.requestId })
    ).rejects.toMatchObject({ name: "DomainError", code: "forbidden" });
  });
});

describe("executeErasure", () => {
  it("is refused while erasure is switched off, and when the plan isn't the one previewed", async () => {
    const h = await createHarness();
    const asha = await participantWithEntry(h, await paidCompetition(h), ASHA);
    const filed = await erasureFiled(h, asha);
    const { plan } = await previewOf(h, filed.officer, filed.requestId);

    expect(
      await h
        .as(filed.officer.actor)
        .executeErasure({ id: filed.requestId, fingerprint: plan.fingerprint })
    ).toEqual({ ok: false, error: "erasure_disabled" });
    await h.settings.set("privacy.erasureEnabled", true);
    expect(
      await h
        .as(filed.officer.actor)
        .executeErasure({ id: filed.requestId, fingerprint: "a".repeat(32) })
    ).toEqual({ ok: false, error: "plan_changed" });
    expect((await requestRows(h))[0]).toMatchObject({
      status: "in_progress",
      erasureFingerprint: null,
    });
  });

  it("needs a fresh second factor", async () => {
    const h = await createHarness();
    await h.settings.set("privacy.erasureEnabled", true);
    const asha = await participantWithEntry(h, await paidCompetition(h), ASHA);
    const filed = await erasureFiled(h, asha);
    const { plan } = await previewOf(h, filed.officer, filed.requestId);
    h.clock.advance({ minutes: 11 });

    await expect(
      h
        .as(filed.officer.actor)
        .executeErasure({ id: filed.requestId, fingerprint: plan.fingerprint })
    ).rejects.toMatchObject({ name: "DomainError", code: "step_up_required" });
    await h.passSecondFactor(filed.officer.actor);
    expect(
      await h
        .as(filed.officer.actor)
        .executeErasure({ id: filed.requestId, fingerprint: plan.fingerprint })
    ).toEqual({ ok: true });
  });

  it("erases a payer's data but keeps the payment, its registration and the account under the floor", async () => {
    const h = await createHarness();
    await h.settings.set("privacy.erasureEnabled", true);
    const asha = await participantWithEntry(h, await paidCompetition(h), ASHA);
    await withMessagesConsent(h, asha);
    const filed = await erasureFiled(h, asha);
    const [entryRow] = await h.db
      .select({ fileId: fileAsset.id, key: fileAsset.storageKey })
      .from(fileAsset)
      .where(eq(fileAsset.ownerUserId, asha.userId));
    expect(h.storage.keys(h.deps.files.bucket)).toContain(entryRow!.key);
    const mark = h.email.sent.length;

    const plan = await erase(h, filed);

    // The profile stays for the paid registration, with nothing of Asha.
    const profile = await profileOf(h, asha.profileId);
    expect(profile).toMatchObject({
      fullName: "[removed]",
      phoneCiphertext: null,
      city: null,
      ownerUserId: null,
      identityHash: `erased:${asha.profileId}`,
    });
    expect(
      h.deps.cipher.decrypt(PROFILE_PURPOSE.dob, profile!.dobCiphertext)
    ).toBe("1900-01-01");
    // The entry and its photo are gone, from the table and the bucket.
    expect(
      await h.db
        .select()
        .from(entry)
        .where(eq(entry.participantProfileId, asha.profileId))
    ).toEqual([]);
    expect(h.storage.keys(h.deps.files.bucket)).not.toContain(entryRow!.key);
    // The payment and its registration stay, still naming the payer.
    expect(
      await h.db.select({ payer: paymentBatch.payerUserId }).from(paymentBatch)
    ).toEqual([{ payer: asha.userId }]);
    expect(
      await h.db
        .select()
        .from(registration)
        .where(eq(registration.id, asha.registrationId))
    ).toHaveLength(1);
    // The account stays with its name and address; nothing else does.
    expect(
      await h.db
        .select({ email: user.email })
        .from(user)
        .where(eq(user.id, asha.userId))
    ).toEqual([{ email: ASHA.email }]);
    expect(
      await h.db.select().from(session).where(eq(session.userId, asha.userId))
    ).toEqual([]);
    // Each consent still given is withdrawn, recorded by the officer.
    const withdrawn = await h.db
      .select()
      .from(consentEvent)
      .where(
        and(
          eq(consentEvent.action, "withdrawn"),
          eq(consentEvent.method, "staff_recorded")
        )
      );
    expect(withdrawn.length).toBeGreaterThan(0);
    expect(withdrawn.every((row) => row.giverUserId === filed.officer.id)).toBe(
      true
    );

    const [request] = await requestRows(h);
    expect(request).toMatchObject({ status: "partially_completed" });
    expect(request!.retained).toEqual(
      expect.arrayContaining([
        {
          category: "payments",
          basis: "financial_floor",
          until: "2035-03-31T18:30:00.000Z",
        },
        expect.objectContaining({
          category: "account",
          basis: "financial_floor",
        }),
      ])
    );
    const records = await h.db.select().from(erasureRecord);
    expect(records).toEqual([
      expect.objectContaining({
        requestId: filed.requestId,
        subjectKind: "user",
        subjectId: asha.userId,
        userIds: [asha.userId],
        profileIds: [asha.profileId],
        outcome: "partially_completed",
        retainedUntil: new Date("2035-03-31T18:30:00.000Z"),
      }),
    ]);
    expect(records[0]!.categories.map((each) => each.key)).toEqual(
      plan.categories.map((each) => each.key)
    );
    // The account stays, so the outcome reaches Asha by route row.
    expect(
      h.email.sent.slice(mark).map((each) => [each.to, each.subject])
    ).toContainEqual([
      ASHA.email,
      `Your privacy request ${filed.reference} is done`,
    ]);

    // Again: the request is closed, and a second delivery changes nothing.
    expect(
      await h
        .as(filed.officer.actor)
        .executeErasure({ id: filed.requestId, fingerprint: plan.fingerprint })
    ).toEqual({ ok: false, error: "request_closed" });
    const consentsAfter = await h.db.select().from(consentEvent);
    await h.drain();
    expect(await h.db.select().from(consentEvent)).toEqual(consentsAfter);
    expect(await h.db.select().from(erasureRecord)).toHaveLength(1);
  });

  it("deletes the account of someone who never paid, and tells them by email", async () => {
    const h = await createHarness();
    await h.settings.set("privacy.erasureEnabled", true);
    const free = await openToIndividuals(h, { fee: 0n });
    const asha = await participantWithEntry(h, free, ASHA);
    const filed = await erasureFiled(h, asha);
    const mark = h.email.sent.length;

    await erase(h, filed);

    expect(
      await h.db.select().from(user).where(eq(user.id, asha.userId))
    ).toEqual([]);
    expect(await profileOf(h, asha.profileId)).toBeUndefined();
    expect(
      await h.db
        .select()
        .from(registration)
        .where(eq(registration.id, asha.registrationId))
    ).toEqual([]);
    const [request] = await h.db
      .select()
      .from(privacyRequest)
      .where(eq(privacyRequest.id, filed.requestId));
    expect(request).toMatchObject({
      status: "partially_completed",
      requestedByUserId: null,
      subjectId: asha.userId,
    });
    const notices = h.email.sent
      .slice(mark)
      .filter((each) => each.to === ASHA.email);
    expect(notices.map((each) => each.subject)).toEqual([
      `Your data has been erased: ${filed.reference}`,
    ]);
  });

  it("deletes a payer's account too when the setting says the payment needn't name them", async () => {
    const h = await createHarness();
    await h.settings.set("privacy.erasureEnabled", true);
    await h.settings.set("privacy.erasureKeepsPayerAccount", false);
    const asha = await participantWithEntry(h, await paidCompetition(h), ASHA);
    const filed = await erasureFiled(h, asha);

    await erase(h, filed);

    expect(
      await h.db.select().from(user).where(eq(user.id, asha.userId))
    ).toEqual([]);
    expect(
      await h.db.select({ payer: paymentBatch.payerUserId }).from(paymentBatch)
    ).toEqual([{ payer: null }]);
    expect((await profileOf(h, asha.profileId))?.fullName).toBe("[removed]");
  });

  it("erases the sole owner of a verified individual directory listing and stops publishing it", async () => {
    const h = await createHarness();
    await h.settings.set("privacy.erasureEnabled", true);
    const listing = await verifiedListing(h, { type: "independent_rescuer" });
    expect(
      await h.as(h.visitor()).getPublicListing({ slug: listing.slug })
    ).toMatchObject({ ok: true });
    const filed = await erasureFiled(h, listing);

    const plan = await erase(h, filed);

    expect(
      await h.as(h.visitor()).getPublicListing({ slug: listing.slug })
    ).toEqual({ ok: false, error: "not_found" });
    expect(
      await h.db.select().from(user).where(eq(user.id, listing.person.id))
    ).toEqual([]);
    expect((await requestRows(h))[0]).toMatchObject({
      status: "partially_completed",
    });
    const reviewed = await h
      .as(listing.staff)
      .getListingForReview({ listingId: listing.listingId });
    expect(reviewed).toMatchObject({
      ok: true,
      listing: {
        status: "withdrawn",
        owner: null,
        name: "[removed]",
        contactPhone: "[removed]",
        contactEmail: null,
        publicContactFields: [],
      },
    });
    expect(plan.categories).toContainEqual(
      expect.objectContaining({
        key: "directory_listings",
        action: "anonymise",
        count: 1,
      })
    );
    const records = await h.db.select().from(erasureRecord);
    expect(records).toHaveLength(1);
    expect(
      await h
        .as(filed.officer.actor)
        .executeErasure({ id: filed.requestId, fingerprint: plan.fingerprint })
    ).toEqual({ ok: false, error: "request_closed" });
    await runExecuteErasure(h.deps, { requestId: filed.requestId });
    expect(await h.db.select().from(erasureRecord)).toEqual(records);
    expect(
      await h
        .as(listing.staff)
        .getListingForReview({ listingId: listing.listingId })
    ).toEqual(reviewed);
  });

  it("hands an organisation's listing to an existing representative without publishing the erased person's details", async () => {
    const h = await createHarness();
    await h.settings.set("privacy.erasureEnabled", true);
    const listing = await verifiedListing(h);
    const next = await h.seed.member({ name: "New representative" });
    await h.seed.grant(next, {
      role: "organisation_representative",
      scope: { type: "organisation", id: listing.listingId },
    });
    const representative = await h.signIn(next);
    const unrelated = await h.signIn(await h.seed.member());
    const ownerDocument = await privateListingDocument(
      h,
      listing.actor,
      listing.listingId
    );
    const representativeDocument = await privateListingDocument(
      h,
      representative,
      listing.listingId
    );
    const animal = await published(h, {
      listingId: listing.listingId,
      slug: listing.slug,
      owner: next,
      actor: representative,
    });
    expect(
      await h.as(h.visitor()).getAdoptableAnimal({ slug: animal.slug })
    ).toMatchObject({ ok: true });
    const filed = await erasureFiled(h, listing);

    await erase(h, filed);

    expect(
      await h.db.select().from(user).where(eq(user.id, listing.person.id))
    ).toEqual([]);
    expect(
      await h.as(h.visitor()).getPublicListing({ slug: listing.slug })
    ).toEqual({ ok: false, error: "not_found" });
    expect(
      await h.as(representative).getMyListing({ listingId: listing.listingId })
    ).toMatchObject({
      ok: true,
      listing: {
        ownerUserId: next.id,
        status: "pending_verification",
        canEdit: true,
        contactEmail: null,
        contactPhone: "[removed]",
      },
    });
    expect(
      await h.as(h.visitor()).getAdoptableAnimal({ slug: animal.slug })
    ).toEqual({ ok: false, error: "not_found" });
    const privateView = await h
      .as(listing.staff)
      .getListingForReview({ listingId: listing.listingId });
    expect(privateView).toMatchObject({
      ok: true,
      listing: {
        documents: [expect.objectContaining({ id: representativeDocument })],
      },
    });
    expect(privateView).not.toMatchObject({
      ok: true,
      listing: {
        documents: expect.arrayContaining([
          expect.objectContaining({ id: ownerDocument }),
        ]),
      },
    });
    await expect(
      h.as(unrelated).getMyListing({ listingId: listing.listingId })
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(
      await h
        .as(listing.staff)
        .verifyListing({ listingId: listing.listingId, reason: "Rechecked" })
    ).toEqual({ ok: false, error: "transition_not_allowed" });
    const update = await h.as(representative).updateListing({
      listingId: listing.listingId,
      ...validListing({
        name: "Paws Rescue",
        contactEmail: "new@example.test",
      }),
    });
    expect(update).toMatchObject({ ok: true });
    if (!update.ok) throw new Error("Expected listing to be editable");
    expect(
      await h.as(listing.staff).verifyListing({
        listingId: listing.listingId,
        reason: "New details verified",
      })
    ).toMatchObject({ ok: true, status: "verified" });
    expect(
      await h.as(h.visitor()).getAdoptableAnimal({ slug: animal.slug })
    ).toMatchObject({ ok: true });
    expect(
      await h.as(h.visitor()).getPublicListing({ slug: update.slug })
    ).toMatchObject({
      ok: true,
      listing: { name: "Paws Rescue", contact: { email: "new@example.test" } },
    });
    expect(
      await h.as(h.visitor()).getPublicListing({ slug: listing.slug })
    ).toEqual({ ok: false, error: "not_found" });
  });

  it("withdraws publication but preserves listing evidence under a legal hold", async () => {
    const h = await createHarness();
    await h.settings.set("privacy.erasureEnabled", true);
    const listing = await verifiedListing(h);
    await withMessagesConsent(h, listing);
    const filed = await erasureFiled(h, listing);
    const officer = await h.signIn(await h.seed.superAdmin());
    expect(
      await h.as(officer).placeLegalHold({
        subjectType: "user",
        subjectId: listing.person.id,
        reason: "Preserve evidence",
      })
    ).toMatchObject({ ok: true });

    const plan = await erase(h, filed);

    expect(plan.categories).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "directory_listings",
          action: "retain",
          basis: "legal_hold",
        }),
        expect.objectContaining({
          key: "directory_publication",
          action: "withdraw",
        }),
        expect.objectContaining({
          key: "account",
          action: "retain",
          basis: "legal_hold",
        }),
      ])
    );
    expect(
      await h.as(h.visitor()).getPublicListing({ slug: listing.slug })
    ).toEqual({ ok: false, error: "not_found" });
    expect(
      await h
        .as(listing.staff)
        .getListingForReview({ listingId: listing.listingId })
    ).toMatchObject({
      ok: true,
      listing: {
        status: "withdrawn",
        ownerUserId: listing.person.id,
        name: "Paws Trust",
        contactEmail: "hello@pawstrust.example.test",
      },
    });
    expect(
      await h
        .as(listing.staff)
        .reinstateListing({
          listingId: listing.listingId,
          reason: "Try to reinstate",
        })
    ).toEqual({ ok: false, error: "transition_not_allowed" });
    expect(
      await h.db.select().from(user).where(eq(user.id, listing.person.id))
    ).toHaveLength(1);
    expect(
      await h.db
        .select()
        .from(consentEvent)
        .where(eq(consentEvent.method, "staff_recorded"))
    ).not.toEqual([]);
  });

  it("refuses a directory erasure if a new hold changes the approved plan, without touching the listing", async () => {
    const h = await createHarness();
    await h.settings.set("privacy.erasureEnabled", true);
    const listing = await verifiedListing(h);
    const filed = await erasureFiled(h, listing);
    const { plan } = await previewOf(h, filed.officer, filed.requestId);
    expect(
      await h
        .as(filed.officer.actor)
        .executeErasure({ id: filed.requestId, fingerprint: plan.fingerprint })
    ).toEqual({ ok: true });
    const admin = await h.signIn(await h.seed.superAdmin());
    expect(
      await h.as(admin).placeLegalHold({
        subjectType: "user",
        subjectId: listing.person.id,
        reason: "New legal hold",
      })
    ).toMatchObject({ ok: true });
    await h.drain();
    expect((await requestRows(h))[0]).toMatchObject({
      status: "in_progress",
      erasureFailure: "plan_changed",
      erasureFingerprint: null,
    });
    expect(
      await h.as(h.visitor()).getPublicListing({ slug: listing.slug })
    ).toMatchObject({ ok: true });
    expect(await h.db.select().from(erasureRecord)).toEqual([]);
    expect(
      await h.db.select().from(user).where(eq(user.id, listing.person.id))
    ).toHaveLength(1);
  });

  it("keeps everything under a legal hold, withdrawing consents only", async () => {
    const h = await createHarness();
    await h.settings.set("privacy.erasureEnabled", true);
    const asha = await participantWithEntry(h, await paidCompetition(h), ASHA);
    await withMessagesConsent(h, asha);
    const filed = await erasureFiled(h, asha);
    const admin = await h.signIn(await h.seed.superAdmin());
    expect(
      await h.as(admin).placeLegalHold({
        subjectType: "user",
        subjectId: asha.userId,
        reason: "A claim about the 2027 competition",
      })
    ).toMatchObject({ ok: true });

    const plan = await erase(h, filed);

    expect(
      plan.categories
        .filter((each) => each.action !== "withdraw")
        .every(
          (each) => each.action === "retain" && each.basis === "legal_hold"
        )
    ).toBe(true);
    expect((await profileOf(h, asha.profileId))?.fullName).toBe(ASHA.name);
    expect(
      await h.db
        .select()
        .from(entry)
        .where(eq(entry.participantProfileId, asha.profileId))
    ).toHaveLength(1);
    expect(
      await h.db
        .select()
        .from(consentEvent)
        .where(eq(consentEvent.method, "staff_recorded"))
    ).not.toEqual([]);
    expect((await requestRows(h))[0]?.status).toBe("partially_completed");
  });

  it("erases a guardian's child, leaving the guardian's own account", async () => {
    const h = await createHarness();
    await h.settings.set("privacy.erasureEnabled", true);
    const family = await h.seed.guardian({
      children: [{ fullName: "Ira Rao", age: 9 }],
    });
    const guardian = await h.signIn(family.account);
    const filed = await h.as(guardian).submitPrivacyRequest({
      type: "erasure",
      subject: { kind: "child", childId: family.childIds[0]! },
    });
    if (!filed.ok) throw new Error("expected a request");
    const officer = await signedInOfficer(h);
    await h.as(officer.actor).startPrivacyRequest({ id: filed.requestId });

    await erase(h, { ...filed, officer });

    expect(await profileOf(h, family.childIds[0]!)).toBeUndefined();
    expect(
      await h.db.select().from(user).where(eq(user.id, family.account.id))
    ).toHaveLength(1);
    expect((await requestRows(h))[0]).toMatchObject({
      requestedByUserId: family.account.id,
    });
  });

  it("refuses at run time a plan that changed after approval, or erasure switched off", async () => {
    const h = await createHarness();
    await h.settings.set("privacy.erasureEnabled", true);
    const asha = await participantWithEntry(h, await paidCompetition(h), ASHA);
    const filed = await erasureFiled(h, asha);
    const { plan } = await previewOf(h, filed.officer, filed.requestId);
    await h
      .as(filed.officer.actor)
      .executeErasure({ id: filed.requestId, fingerprint: plan.fingerprint });
    // The account would now go instead of staying: another plan.
    await h.settings.set("privacy.erasureKeepsPayerAccount", false);

    await h.drain();

    expect((await requestRows(h))[0]).toMatchObject({
      status: "in_progress",
      erasureFingerprint: null,
      erasureFailure: "plan_changed",
    });
    expect((await profileOf(h, asha.profileId))?.fullName).toBe(ASHA.name);
    const audit = await h.db
      .select({ action: auditLog.action })
      .from(auditLog)
      .where(eq(auditLog.entityId, filed.requestId))
      .orderBy(asc(auditLog.id));
    expect(audit.map((row) => row.action)).toContain(
      "privacy_request.erasure_refused"
    );

    // Approved again, then switched off before the worker runs.
    const again = await previewOf(h, filed.officer, filed.requestId);
    await h.as(filed.officer.actor).executeErasure({
      id: filed.requestId,
      fingerprint: again.plan.fingerprint,
    });
    await h.settings.set("privacy.erasureEnabled", false);
    await h.drain();
    expect((await requestRows(h))[0]).toMatchObject({
      status: "in_progress",
      erasureFailure: "erasure_disabled",
    });
  });
});
