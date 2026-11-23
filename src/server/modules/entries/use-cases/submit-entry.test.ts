import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import {
  entry,
  entryFile,
  entryUploadGrant,
  fileAsset,
} from "@/server/db/schema";
import { DomainError } from "@/server/errors";
import {
  adultForm,
  openToIndividuals,
  signInMember,
} from "@/server/modules/participants/testing";
import { signInStaff } from "@/server/modules/payments/testing";
import { createHarness, type Harness } from "@/test/harness";

import {
  confirmedAdult,
  ENTRY_TEXT,
  PHOTO,
  putEntryImage,
  submitImage,
  submittedImage,
} from "../testing";

// #85: a confirmed individual participant uploads a picture of their work,
// with a title, a short description and an optional statement. Starting
// checks the file against the discipline's rule and presigns its upload;
// completing takes it and creates the entry, with its Entry ID, in
// `processing` until its file passes the checks.

const ENTRY_ID = /^[A-Z]{3,6}\d{2}-E-[0-9A-HJKMNP-TV-Z]{6}$/;
const IMAGE_FILE = { name: "work.jpg", type: "image/jpeg", size: PHOTO.length };

async function anotherConfirmedRegistration(
  h: Harness,
  app: ReturnType<Harness["as"]>
) {
  const competition = await openToIndividuals(h, { fee: 0n });
  const registered = await app.registerAsIndividual(adultForm(competition));
  if (!registered.ok) throw new Error(registered.error);
  const paid = await app.payForMyRegistration({
    registrationId: registered.registrationId,
  });
  if (!paid.ok) throw new Error(paid.error);
  return registered.registrationId;
}

describe("startEntryUpload and completeEntryUpload", () => {
  it("creates the entry in processing with its Entry ID, which the participant's list shows", async () => {
    const h = await createHarness();
    const asha = await confirmedAdult(h, { code: "PAWS27" });

    const completed = await submitImage(h, asha, {
      text: { ...ENTRY_TEXT, statement: "I feed him every evening." },
    });

    expect(completed).toEqual({
      ok: true,
      entryCode: expect.stringMatching(ENTRY_ID),
      status: "processing",
    });
    if (!completed.ok) return;
    expect(completed.entryCode.startsWith("PAWS27-E-")).toBe(true);
    expect(await h.as(asha.actor).listMyEntries()).toEqual([
      {
        code: completed.entryCode,
        status: "processing",
        title: ENTRY_TEXT.title,
        discipline: "photography",
        competition: {
          name: "Seed competition 1",
          slug: asha.competition.slug,
        },
        registrationId: asha.registrationId,
        participantName: "Asha Rao",
        whose: "mine",
        checking: true,
        submittedAt: null,
      },
    ]);
  });

  it("presigns the picture as a private entry image of the declared type and size", async () => {
    const h = await createHarness();
    const asha = await confirmedAdult(h);

    const started = await h.as(asha.actor).startEntryUpload({
      registrationId: asha.registrationId,
      discipline: "drawing",
      file: { name: "Drawing.JPG", type: "", size: PHOTO.length },
    });

    expect(started).toEqual({
      ok: true,
      fileId: expect.any(String),
      uploadUrl: expect.any(String),
      headers: { "Content-Type": "image/jpeg" },
      expiresAt: expect.any(Date),
    });
    if (!started.ok) return;
    const [file] = await h.db
      .select()
      .from(fileAsset)
      .where(eq(fileAsset.id, started.fileId));
    expect(file).toMatchObject({
      ownerUserId: asha.userId,
      purpose: "entry_image",
      contentType: "image/jpeg",
      sizeBytes: PHOTO.length,
      status: "pending_upload",
    });
  });

  it("allows one open grant per registration and cleans up an unused upload at expiry", async () => {
    const h = await createHarness();
    const asha = await confirmedAdult(h);
    const app = h.as(asha.actor);
    const start = () =>
      app.startEntryUpload({
        registrationId: asha.registrationId,
        discipline: "drawing",
        file: IMAGE_FILE,
      });

    const grants = await Promise.all([start(), start()]);
    expect(
      grants.map((grant) => (grant.ok ? "signed" : grant.error)).sort()
    ).toEqual(["signed", "upload_limit"]);
    const first = grants.find((grant) => grant.ok);
    if (!first?.ok) throw new Error("No initial upload grant");
    expect(await h.storage.put(first.uploadUrl, PHOTO, first.headers)).toEqual({
      ok: true,
    });
    const [asset] = await h.db
      .select()
      .from(fileAsset)
      .where(eq(fileAsset.id, first.fileId));
    const staged = {
      bucket: asset!.bucket,
      key: `local/incoming/${first.fileId}`,
    };
    expect(await h.storage.head(staged)).toMatchObject({
      sizeBytes: PHOTO.length,
    });

    h.clock.set(new Date(first.expiresAt.getTime() + 1000));
    expect(
      await app.completeEntryUpload({
        registrationId: asha.registrationId,
        fileId: first.fileId,
        ...ENTRY_TEXT,
      })
    ).toEqual({ ok: false, error: "file_not_found" });
    const retry = await submitImage(h, asha);
    expect(retry).toMatchObject({ ok: true, status: "processing" });
    await h.drain();
    expect(await h.storage.head(staged)).toBeNull();
    expect(
      await h.db.select().from(fileAsset).where(eq(fileAsset.id, first.fileId))
    ).toEqual([]);
    expect(await app.listMyEntries()).toMatchObject([{ status: "submitted" }]);
  });

  it.each(["unused", "accepted"] as const)(
    "clears a staged write that finishes after cleanup of an %s grant",
    async (state) => {
      const h = await createHarness();
      const asha = await confirmedAdult(h);
      const app = h.as(asha.actor);
      const started = await app.startEntryUpload({
        registrationId: asha.registrationId,
        discipline: "drawing",
        file: IMAGE_FILE,
      });
      if (!started.ok) throw new Error(started.error);
      const [asset] = await h.db
        .select()
        .from(fileAsset)
        .where(eq(fileAsset.id, started.fileId));
      const original = { bucket: asset!.bucket, key: asset!.storageKey };
      const staged = {
        bucket: asset!.bucket,
        key: `local/incoming/${started.fileId}`,
      };

      if (state === "accepted") {
        expect(
          await h.storage.put(started.uploadUrl, PHOTO, started.headers)
        ).toEqual({ ok: true });
        expect(
          await app.completeEntryUpload({
            registrationId: asha.registrationId,
            discipline: "drawing",
            fileId: started.fileId,
            ...ENTRY_TEXT,
          })
        ).toMatchObject({ ok: true, status: "processing" });
        await h.drain();
      }

      h.clock.set(new Date(started.expiresAt.getTime() + 1000));
      await h.drain();
      expect(await h.db.select().from(entryUploadGrant)).toEqual([]);
      expect(await h.storage.head(staged)).toBeNull();

      // Model a storage provider finishing a PUT it accepted before expiry.
      await h.storage.write({
        ...staged,
        body: PHOTO,
        contentType: "image/jpeg",
      });
      h.clock.advance({ hours: 1 });
      await h.drain();

      expect(await h.storage.head(staged)).toBeNull();
      if (state === "accepted") {
        expect(await h.storage.head(original)).toMatchObject({
          sizeBytes: PHOTO.length,
        });
        expect(await app.listMyEntries()).toMatchObject([
          { status: "submitted" },
        ]);
      } else {
        expect(await h.storage.head(original)).toBeNull();
      }
    }
  );

  it("caps an actor's outstanding grants across confirmed registrations", async () => {
    const h = await createHarness();
    const asha = await confirmedAdult(h);
    const app = h.as(asha.actor);
    const registrations = [asha.registrationId];
    for (let i = 0; i < 3; i += 1) {
      registrations.push(await anotherConfirmedRegistration(h, app));
    }

    const grants = await Promise.all(
      registrations.map((registrationId) =>
        app.startEntryUpload({
          registrationId,
          discipline: "drawing",
          file: IMAGE_FILE,
        })
      )
    );
    expect(
      grants.map((grant) => (grant.ok ? "signed" : grant.error)).sort()
    ).toEqual(["signed", "signed", "signed", "upload_limit"]);
  });

  it("caps grant creation even when the actor finishes each upload", async () => {
    const h = await createHarness();
    const asha = await confirmedAdult(h);
    const app = h.as(asha.actor);
    for (let i = 0; i < 6; i += 1) {
      expect(await submitImage(h, asha)).toMatchObject({
        ok: true,
        status: "processing",
      });
    }
    const next = await app.startEntryUpload({
      registrationId: asha.registrationId,
      discipline: "drawing",
      file: IMAGE_FILE,
    });
    expect(next.ok ? "signed" : next.error).toBe("upload_limit");
  });

  it("counts retired URLs toward the issuance cap until they expire", async () => {
    const h = await createHarness();
    const asha = await confirmedAdult(h);
    const app = h.as(asha.actor);
    const input = {
      registrationId: asha.registrationId,
      discipline: "drawing",
      file: IMAGE_FILE,
    };
    let grant = await app.startEntryUpload(input);
    for (let i = 1; i < 6; i += 1) {
      if (!grant.ok) throw new Error(grant.error);
      grant = await app.startEntryUpload({
        ...input,
        replacesFileId: grant.fileId,
      });
    }
    if (!grant.ok) throw new Error(grant.error);
    expect(
      await app.startEntryUpload({ ...input, replacesFileId: grant.fileId })
    ).toEqual({ ok: false, error: "upload_limit" });
    expect(
      await app.startEntryUpload({ ...input, restartPendingUpload: true })
    ).toEqual({ ok: false, error: "upload_limit" });
    expect(await h.storage.put(grant.uploadUrl, PHOTO, grant.headers)).toEqual({
      ok: true,
    });
    expect(
      await app.completeEntryUpload({
        ...input,
        fileId: grant.fileId,
        ...ENTRY_TEXT,
      })
    ).toMatchObject({ ok: true, status: "processing" });
  });

  it("accepts an upload only for the registration it was granted to", async () => {
    const h = await createHarness();
    const asha = await confirmedAdult(h);
    const app = h.as(asha.actor);
    const secondRegistration = await anotherConfirmedRegistration(h, app);
    const request = await putEntryImage(h, asha);

    expect(
      await app.completeEntryUpload({
        ...request,
        registrationId: secondRegistration,
      })
    ).toEqual({ ok: false, error: "file_not_found" });
    await h.drain();
    expect(h.scanner.scans).toBe(0);
    expect(await app.completeEntryUpload(request)).toMatchObject({
      ok: true,
      status: "processing",
    });
  });

  it("leaves an entry upload pending when it is sent to generic Files completion", async () => {
    const h = await createHarness();
    const asha = await confirmedAdult(h);
    const app = h.as(asha.actor);
    const request = await putEntryImage(h, asha);

    expect(await app.completeUpload({ fileId: request.fileId })).toEqual({
      ok: false,
      error: "not_found",
    });
    await h.drain();
    expect(h.scanner.scans).toBe(0);
    expect(await app.completeEntryUpload(request)).toMatchObject({
      ok: true,
      status: "processing",
    });
  });

  it("refuses a generic Files request for an entry image without creating an asset", async () => {
    const h = await createHarness();
    const asha = await confirmedAdult(h);
    const app = h.as(asha.actor);

    expect(
      await app.requestUpload({
        purpose: "entry_image",
        contentType: "image/jpeg",
        sizeBytes: PHOTO.length,
      })
    ).toEqual({ ok: false, error: "purpose_unavailable" });
    expect(
      await h.db
        .select()
        .from(fileAsset)
        .where(eq(fileAsset.purpose, "entry_image"))
    ).toEqual([]);
  });

  it.each([
    [{ name: "work.gif", type: "image/gif", size: 1000 }, "wrong_type"],
    [{ name: "work.pdf", type: "application/pdf", size: 1000 }, "wrong_type"],
    [{ name: "work", type: "", size: 1000 }, "wrong_type"],
    [
      { name: "huge.jpg", type: "image/jpeg", size: 20 * 1024 * 1024 + 1 },
      "too_large",
    ],
    [{ name: "empty.jpg", type: "image/jpeg", size: 0 }, "empty"],
  ])(
    "refuses %j at the start with %s, and presigns nothing",
    async (file, error) => {
      const h = await createHarness();
      const asha = await confirmedAdult(h);

      const started = await h.as(asha.actor).startEntryUpload({
        registrationId: asha.registrationId,
        discipline: "drawing",
        file,
      });

      expect(started).toEqual({ ok: false, error });
      expect(await h.db.select().from(fileAsset)).toEqual([]);
    }
  );

  it("refuses again at completion when storage holds something else than was declared", async () => {
    const h = await createHarness();
    const asha = await confirmedAdult(h);
    const started = await h.as(asha.actor).startEntryUpload({
      registrationId: asha.registrationId,
      discipline: "drawing",
      file: { name: "small.jpg", type: "image/jpeg", size: 1000 },
    });
    if (!started.ok) throw new Error(JSON.stringify(started));
    // The browser sent other bytes than it declared, past the signed
    // length: stand in for it at the upload key.
    const [file] = await h.db
      .select()
      .from(fileAsset)
      .where(eq(fileAsset.id, started.fileId));
    h.storage.plant({
      bucket: file!.bucket,
      key: `local/incoming/${started.fileId}`,
      bytes: PHOTO,
      contentType: "image/jpeg",
    });

    const completed = await h.as(asha.actor).completeEntryUpload({
      registrationId: asha.registrationId,
      discipline: "drawing",
      fileId: started.fileId,
      ...ENTRY_TEXT,
    });

    expect(completed).toEqual({ ok: false, error: "upload_rejected" });
    expect(await h.db.select().from(entry)).toEqual([]);
  });

  it("says when nothing has arrived in storage yet, and creates nothing", async () => {
    const h = await createHarness();
    const asha = await confirmedAdult(h);
    const started = await h.as(asha.actor).startEntryUpload({
      registrationId: asha.registrationId,
      discipline: "drawing",
      file: { name: "work.jpg", type: "image/jpeg", size: PHOTO.length },
    });
    if (!started.ok) throw new Error(JSON.stringify(started));

    const completed = await h.as(asha.actor).completeEntryUpload({
      registrationId: asha.registrationId,
      discipline: "drawing",
      fileId: started.fileId,
      ...ENTRY_TEXT,
    });

    expect(completed).toEqual({ ok: false, error: "upload_missing" });
    expect(await h.db.select().from(entry)).toEqual([]);
  });

  it("checks the words: a title and a description, each within its limit", async () => {
    const h = await createHarness();
    const asha = await confirmedAdult(h);

    const completed = await submitImage(h, asha, {
      text: { title: "  ", description: "x".repeat(501) },
    });

    expect(completed).toEqual({
      ok: false,
      error: "invalid_input",
      fields: ["title", "description"],
    });
    expect(await h.db.select().from(entry)).toEqual([]);
  });

  it("takes a discipline the competition holds whose work is a picture, and only that", async () => {
    const h = await createHarness();
    const asha = await confirmedAdult(h, { disciplines: ["drawing", "essay"] });

    const essay = await h.as(asha.actor).startEntryUpload({
      registrationId: asha.registrationId,
      discipline: "essay",
      file: { name: "work.jpg", type: "image/jpeg", size: 1000 },
    });
    const craft = await h.as(asha.actor).startEntryUpload({
      registrationId: asha.registrationId,
      discipline: "craft",
      file: { name: "work.jpg", type: "image/jpeg", size: 1000 },
    });

    expect(essay).toEqual({ ok: false, error: "discipline_not_offered" });
    expect(craft).toEqual({ ok: false, error: "discipline_not_offered" });
  });

  it("keeps one entry per registration: a second upload replaces the file", async () => {
    const h = await createHarness();
    const asha = await confirmedAdult(h);
    const first = await submittedImage(h, asha);

    const second = await submitImage(h, asha, {
      discipline: "painting",
      text: { title: "Second go", description: "A better photo of it." },
    });

    expect(second).toEqual({
      ok: true,
      entryCode: first,
      status: "processing",
    });
    const entries = await h.db.select().from(entry);
    expect(entries).toHaveLength(1);
    // The discipline was chosen with the first upload; the words are the
    // latest.
    expect(entries[0]).toMatchObject({
      discipline: "photography",
      title: "Second go",
    });
    expect(await h.db.select().from(entryFile)).toHaveLength(2);
  });

  it("refuses a registration that isn't confirmed yet", async () => {
    const h = await createHarness();
    const competition = await openToIndividuals(h);
    const ravi = await signInMember(h, { name: "Ravi Kumar" });
    const pending = await h
      .as(ravi.actor)
      .registerAsIndividual(adultForm(competition));
    if (!pending.ok) throw new Error(JSON.stringify(pending));

    const started = await h.as(ravi.actor).startEntryUpload({
      registrationId: pending.registrationId,
      discipline: "drawing",
      file: { name: "work.jpg", type: "image/jpeg", size: 1000 },
    });

    expect(started).toEqual({ ok: false, error: "registration_not_confirmed" });
  });

  it.each(["first upload", "replacement"])(
    "refuses a %s when a refund wins the race with completion",
    async (kind) => {
      const h = await createHarness();
      const competition = await openToIndividuals(h);
      const member = await signInMember(h);
      const app = h.as(member.actor);
      const registered = await app.registerAsIndividual(adultForm(competition));
      if (!registered.ok) throw new Error("Registration was refused");
      const { registrationId } = registered;
      const paid = await app.payForMyRegistration({ registrationId });
      if (!paid.ok || paid.kind !== "checkout") throw new Error("No checkout");
      const { orderId } = paid.checkout;
      h.gateway.capture(orderId);
      expect(
        await h
          .as(h.visitor())
          .receiveGatewayWebhook(
            h.gateway.webhook({ type: "payment.captured", orderId })
          )
      ).toMatchObject({ ok: true, outcome: "captured" });

      if (kind === "replacement") {
        await submittedImage(h, { actor: member.actor, registrationId });
        await h.drain();
      }
      const before = await app.listMyEntries();
      const staff = await signInStaff(h, "staff_admin");
      const asked = await h.as(staff.actor).requestRefund({
        batchId: paid.batchId,
        reason: "The participant cannot attend this competition.",
      });
      if (!asked.ok) throw new Error("Refund request was refused");
      const finance = await signInStaff(h, "finance");
      expect(
        await h.as(finance.actor).approveRefund({ refundId: asked.refundId })
      ).toMatchObject({ ok: true, status: "approved" });

      const started = await app.startEntryUpload({
        registrationId,
        discipline: "drawing",
        file: { name: "work.jpg", type: "image/jpeg", size: PHOTO.length },
      });
      if (!started.ok) throw new Error("Upload was refused");
      expect(
        await h.storage.put(started.uploadUrl, PHOTO, started.headers)
      ).toEqual({ ok: true });

      // Let the refund reach its provider. Release it during the upload's
      // HEAD so its write queues before Entries can take the registration lock.
      const refundAtGateway = Promise.withResolvers<void>();
      const releaseRefund = Promise.withResolvers<void>();
      const sendRefund = h.gateway.refund.bind(h.gateway);
      h.gateway.answerNextRefund("processed");
      vi.spyOn(h.gateway, "refund").mockImplementationOnce(async (request) => {
        const sent = await sendRefund(request);
        refundAtGateway.resolve();
        await releaseRefund.promise;
        return sent;
      });
      const refundDelivery = h.drain();
      let completed: Awaited<ReturnType<typeof app.completeEntryUpload>>;
      try {
        await Promise.race([
          refundAtGateway.promise,
          refundDelivery.then(() => {
            throw new Error("Refund did not reach the gateway");
          }),
        ]);
        const head = h.storage.head.bind(h.storage);
        vi.spyOn(h.storage, "head").mockImplementationOnce((ref) => {
          releaseRefund.resolve();
          return head(ref);
        });
        completed = await app.completeEntryUpload({
          registrationId,
          discipline: "drawing",
          fileId: started.fileId,
          ...ENTRY_TEXT,
          title: "An upload still in flight",
        });
      } finally {
        releaseRefund.resolve();
        await refundDelivery;
      }

      expect(await app.listMyRegistrations()).toMatchObject([
        { status: "refunded" },
      ]);
      expect(completed).toEqual({
        ok: false,
        error: "registration_not_confirmed",
      });
      expect(await app.listMyEntries()).toEqual(before);
    }
  );

  it("refuses another participant's registration as forbidden, as one that doesn't exist", async () => {
    const h = await createHarness();
    const asha = await confirmedAdult(h);
    const ravi = await confirmedAdult(h, {
      competition: asha.competition,
      name: "Ravi Kumar",
    });
    const file = { name: "work.jpg", type: "image/jpeg", size: 1000 };

    await expect(
      h.as(ravi.actor).startEntryUpload({
        registrationId: asha.registrationId,
        discipline: "drawing",
        file,
      })
    ).rejects.toThrow(DomainError);
    await expect(
      h.as(ravi.actor).startEntryUpload({
        registrationId: "01938a00-0000-7000-8000-00000000dead",
        discipline: "drawing",
        file,
      })
    ).rejects.toThrow(DomainError);
    await expect(
      h.as(h.visitor()).startEntryUpload({
        registrationId: asha.registrationId,
        discipline: "drawing",
        file,
      })
    ).rejects.toThrow(DomainError);
    expect(await h.db.select().from(fileAsset)).toEqual([]);
  });

  it("refuses to complete for another participant's registration", async () => {
    const h = await createHarness();
    const asha = await confirmedAdult(h);
    const ravi = await confirmedAdult(h, {
      competition: asha.competition,
      name: "Ravi Kumar",
    });
    const started = await h.as(ravi.actor).startEntryUpload({
      registrationId: ravi.registrationId,
      discipline: "drawing",
      file: { name: "work.jpg", type: "image/jpeg", size: PHOTO.length },
    });
    if (!started.ok) throw new Error(JSON.stringify(started));
    await h.storage.put(started.uploadUrl, PHOTO, started.headers);

    await expect(
      h.as(ravi.actor).completeEntryUpload({
        registrationId: asha.registrationId,
        discipline: "drawing",
        fileId: started.fileId,
        ...ENTRY_TEXT,
      })
    ).rejects.toThrow(DomainError);
    // Asha gets the same refusal for Ravi's upload and a missing upload.
    for (const fileId of [
      "01938a00-0000-7000-8000-00000000dead",
      started.fileId,
    ]) {
      expect(
        await h.as(asha.actor).completeEntryUpload({
          registrationId: asha.registrationId,
          discipline: "drawing",
          fileId,
          ...ENTRY_TEXT,
        })
      ).toEqual({ ok: false, error: "file_not_found" });
    }
    expect(await h.db.select().from(entry)).toEqual([]);
  });

  it("lists nothing for a member with no entries, and refuses a visitor", async () => {
    const h = await createHarness();
    const asha = await confirmedAdult(h);

    expect(await h.as(asha.actor).listMyEntries()).toEqual([]);
    await expect(h.as(h.visitor()).listMyEntries()).rejects.toThrow(
      DomainError
    );
  });
});
