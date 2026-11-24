import { asc, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import type { Actor } from "@/server/actor";
import { auditLog } from "@/server/db/schema";
import { DomainError } from "@/server/errors";
import { createHarness, type Harness } from "@/test/harness";

import { DOCUMENTS_PER_LISTING_MAX } from "./documents";
import {
  registeredListing,
  signedInStaff,
  verifiedListing,
} from "./testing";

const PDF = new TextEncoder().encode("%PDF-1.7\n% a trust deed\n%%EOF\n");

/** Uploads a PDF to the listing as `actor`, the way the page does. */
async function uploadDocument(
  h: Harness,
  actor: Actor,
  listingId: string,
  kind = "registration_certificate"
) {
  const requested = await h.as(actor).requestListingDocumentUpload({
    listingId,
    kind,
    contentType: "application/pdf",
    sizeBytes: PDF.length,
  });
  if (!requested.ok) throw new Error(`Upload refused: ${requested.error}`);
  await h.storage.put(requested.uploadUrl, PDF, requested.headers);
  const completed = await h
    .as(actor)
    .completeUpload({ fileId: requested.fileId });
  if (!completed.ok) throw new Error(`Not completed: ${completed.error}`);
  return { documentId: requested.documentId, fileId: requested.fileId };
}

describe("requestListingDocumentUpload", () => {
  it("lets the registrant send proof that staff see on the checklist, without the file itself", async () => {
    const h = await createHarness();
    const { listingId, actor } = await registeredListing(h);

    const { documentId } = await uploadDocument(h, actor, listingId);

    const mine = await h.as(actor).getMyListing({ listingId });
    expect(mine).toMatchObject({
      ok: true,
      listing: {
        canAddDocuments: true,
        documents: [
          {
            id: documentId,
            kind: "registration_certificate",
            fileStatus: "uploaded",
          },
        ],
      },
    });
    const staff = await signedInStaff(h);
    expect(
      await h.as(staff).getListingForReview({ listingId })
    ).toMatchObject({
      ok: true,
      listing: {
        documents: [{ id: documentId, kind: "registration_certificate" }],
        checklist: [
          {
            kind: "registration_certificate",
            expected: "required",
            provided: true,
          },
          { kind: "awbi_recognition", expected: "optional", provided: false },
        ],
      },
    });
    const [audit] = await h.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, "directory.document_added"));
    expect(audit).toMatchObject({
      entityId: listingId,
      after: { documentId, kind: "registration_certificate" },
    });
  });

  it("lets a representative add proof to a verified listing", async () => {
    const h = await createHarness();
    const { listingId, actor } = await verifiedListing(h);

    const { documentId } = await uploadDocument(
      h,
      actor,
      listingId,
      "awbi_recognition"
    );

    expect(await h.as(actor).getMyListing({ listingId })).toMatchObject({
      ok: true,
      listing: { documents: [{ id: documentId, kind: "awbi_recognition" }] },
    });
  });

  it("refuses a file type or size the purpose doesn't take, and a rejected listing", async () => {
    const h = await createHarness();
    const { listingId, actor } = await registeredListing(h);
    const request = (changes: object) =>
      h.as(actor).requestListingDocumentUpload({
        listingId,
        kind: "identity_proof",
        contentType: "application/pdf",
        sizeBytes: 1000,
        ...changes,
      });

    expect(await request({ contentType: "text/html" })).toEqual({
      ok: false,
      error: "type_not_allowed",
    });
    expect(await request({ sizeBytes: 11 * 1024 * 1024 })).toEqual({
      ok: false,
      error: "too_large",
    });
    expect(await request({ kind: "selfie" })).toEqual({
      ok: false,
      error: "invalid_input",
      fields: ["kind"],
    });

    await h
      .as(await signedInStaff(h))
      .rejectListing({ listingId, reason: "No proof of registration." });
    expect(await request({})).toEqual({
      ok: false,
      error: "listing_not_editable",
    });
  });

  it(`stops at ${DOCUMENTS_PER_LISTING_MAX} documents`, async () => {
    const h = await createHarness();
    const { listingId, actor } = await registeredListing(h);
    for (let i = 0; i < DOCUMENTS_PER_LISTING_MAX; i++) {
      await uploadDocument(h, actor, listingId, "other");
    }

    expect(
      await h.as(actor).requestListingDocumentUpload({
        listingId,
        kind: "other",
        contentType: "application/pdf",
        sizeBytes: PDF.length,
      })
    ).toEqual({ ok: false, error: "too_many_documents" });
  });

  it("refuses another member and the general upload route", async () => {
    const h = await createHarness();
    const { listingId } = await registeredListing(h);
    const member = await h.signIn(await h.seed.member());

    await expect(
      h.as(member).requestListingDocumentUpload({
        listingId,
        kind: "other",
        contentType: "application/pdf",
        sizeBytes: PDF.length,
      })
    ).rejects.toThrow(DomainError);
    expect(
      await h.as(member).requestUpload({
        purpose: "directory_document",
        contentType: "application/pdf",
        sizeBytes: PDF.length,
      })
    ).toEqual({ ok: false, error: "purpose_unavailable" });
  });
});

describe("getListingDocumentUrl", () => {
  it("gives staff admins and super admins a signed URL once the scan passes, and audits each read", async () => {
    const h = await createHarness();
    const { listingId, actor } = await registeredListing(h);
    const { documentId, fileId } = await uploadDocument(h, actor, listingId);
    const staff = await signedInStaff(h);
    const admin = await signedInStaff(h, "super_admin");

    expect(await h.as(staff).getListingDocumentUrl({ documentId })).toEqual({
      ok: false,
      error: "file_not_ready",
    });
    await h.drain();

    for (const who of [staff, admin]) {
      const result = await h.as(who).getListingDocumentUrl({ documentId });
      if (!result.ok) throw new Error(`Refused: ${result.error}`);
      expect(await h.storage.get(result.url)).toMatchObject({
        ok: true,
        contentType: "application/pdf",
      });
    }
    const reads = await h.db
      .select({ role: auditLog.actorRole })
      .from(auditLog)
      .where(eq(auditLog.action, "file.read"))
      .orderBy(asc(auditLog.id));
    expect(reads).toEqual([{ role: "staff_admin" }, { role: "super_admin" }]);
    expect(await h.as(staff).getFileDownloadUrl({ fileId })).toMatchObject({
      ok: true,
    });
  });

  it("refuses the uploader, the representative, another member and a visitor, by either route", async () => {
    const h = await createHarness();
    const { listingId, actor } = await verifiedListing(h);
    const { documentId, fileId } = await uploadDocument(h, actor, listingId);
    await h.drain();
    const refused = [
      actor,
      await h.signIn(await h.seed.member()),
      await signedInStaff(h, "community_manager"),
      h.visitor(),
    ];

    for (const who of refused) {
      await expect(
        h.as(who).getListingDocumentUrl({ documentId })
      ).rejects.toThrow(DomainError);
      await expect(
        h.as(who).getFileDownloadUrl({ fileId })
      ).rejects.toThrow(DomainError);
    }
  });

  it("answers not found for a document that doesn't exist", async () => {
    const h = await createHarness();
    const staff = await signedInStaff(h);

    expect(
      await h.as(staff).getListingDocumentUrl({
        documentId: "01938a00-0000-7000-8000-00000000dead",
      })
    ).toEqual({ ok: false, error: "not_found" });
  });
});
