import { and, eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import type { Actor } from "@/server/actor";
import {
  entry,
  entryFile,
  entryUploadGrant,
  guardianLink,
  outbox,
} from "@/server/db/schema";
import { DomainError } from "@/server/errors";
import {
  adultForm,
  openToIndividuals,
} from "@/server/modules/participants/testing";
import {
  schoolWithStudents,
  signInStaff,
} from "@/server/modules/payments/testing";
import { createHarness, type Harness } from "@/test/harness";
import { readMediaFixture } from "@/test/media-fixtures";

import {
  confirmedAdult,
  confirmedChild,
  ENTRY_TEXT,
  PHOTO,
  putEntryImage,
  submittedImage,
} from "../testing";

// #85: who may submit and read an entry. The adult on their own
// registration, and a verified guardian for their ward; nobody else: not
// another participant, another child's guardian, a coordinator, a
// competition manager or a visitor. A school's student is entered by their
// own institution's coordinators (#87, ./coordinator-submit.test.ts) and by
// nobody else.

const FILE = { name: "work.jpg", type: "image/jpeg", size: PHOTO.length };

it("refuses a visitor before validating entry reads and uploads", async () => {
  const h = await createHarness();
  const app = h.as(h.visitor());
  const registrationId = "not-a-registration-id";

  const results = await Promise.allSettled([
    app.startEntryUpload({ registrationId, file: FILE }),
    app.completeEntryUpload({ registrationId, fileId: "", ...ENTRY_TEXT }),
    app.getEntryUploadOptions({ registrationId }),
    app.getEntry({ code: "x".repeat(41) }),
  ]);
  expect(results).toEqual(
    Array.from({ length: 4 }, () => ({
      status: "rejected",
      reason: expect.objectContaining({ code: "forbidden" }),
    }))
  );
});

function start(h: Harness, actor: Actor, registrationId: string) {
  return h
    .as(actor)
    .startEntryUpload({ registrationId, discipline: "drawing", file: FILE });
}

async function confirmedLinkedTeen(h: Harness) {
  const competition = await openToIndividuals(h, { fee: 0n });
  const teen = await h.seed.member({ name: "Rohan Desai" });
  const family = await h.seed.guardian({
    children: [{ fullName: "Rohan Desai", age: 15, loginUserId: teen.id }],
  });
  const actor = await h.signIn(teen);
  const guardian = h.as(await h.signIn(family.account));
  const registered = await h
    .as(actor)
    .registerAsIndividual(adultForm(competition, { fullName: "Rohan Desai" }));
  expect(registered).toMatchObject({
    ok: true,
    status: "pending_guardian",
    payNow: false,
  });
  if (!registered.ok) throw new Error(registered.error);
  const { registrationId } = registered;
  await expect(
    guardian.giveChildConsent({
      childId: family.childIds[0]!,
      competitionId: competition.id,
      purpose: "participation",
      documentId: competition.guardianDocuments.participation!,
    })
  ).resolves.toMatchObject({ ok: true });
  await expect(
    h.as(actor).payForMyRegistration({ registrationId })
  ).rejects.toMatchObject({ code: "forbidden" });
  await expect(
    guardian.payForMyRegistration({ registrationId })
  ).resolves.toMatchObject({ ok: true, kind: "confirmed_free" });
  await h.drain();
  return {
    actor,
    registrationId,
    guardian,
    childId: family.childIds[0]!,
    competition,
    email: family.account.email,
    teenEmail: teen.email,
  };
}

describe("entries for a linked teen", () => {
  it("offers submission to the linked teen after their guardian confirms the registration", async () => {
    const h = await createHarness();
    const { actor, registrationId } = await confirmedLinkedTeen(h);
    const app = h.as(actor);

    expect(await app.listMyRegistrations()).toMatchObject([
      {
        registrationId,
        whose: "mine",
        status: "confirmed",
        maySubmitEntry: true,
      },
    ]);
    expect(await app.getEntryUploadOptions({ registrationId })).toMatchObject({
      ok: true,
      whose: "mine",
      participantName: "Rohan Desai",
    });
  });

  it("withholds upload options and new grants from a confirmed teen after participation is withdrawn", async () => {
    const h = await createHarness();
    const teen = await confirmedLinkedTeen(h);
    const app = h.as(teen.actor);
    const { registrationId } = teen;

    await expect(
      teen.guardian.withdrawChildConsent({
        childId: teen.childId,
        competitionId: teen.competition.id,
        purpose: "participation",
      })
    ).resolves.toEqual({ ok: true, changed: true });

    const options = await app.getEntryUploadOptions({ registrationId });
    const grant = await start(h, teen.actor, registrationId);
    const [registration] = await app.listMyRegistrations();
    const grants = await h.db.select().from(entryUploadGrant);
    expect({
      options: options.ok ? "offered" : options.error,
      grant: grant.ok ? "issued" : grant.error,
      status: registration?.status,
      maySubmitEntry: registration?.maySubmitEntry,
      grantCount: grants.length,
    }).toEqual({
      options: "participation_consent_required",
      grant: "participation_consent_required",
      status: "confirmed",
      maySubmitEntry: false,
      grantCount: 0,
    });
  });

  it("lets a linked teen submit and replace their work while their guardian gets the receipt", async () => {
    const h = await createHarness();
    const teen = await confirmedLinkedTeen(h);
    const app = h.as(teen.actor);

    const upload = await putEntryImage(h, teen);
    await expect(
      teen.guardian.startEntryUpload({
        registrationId: teen.registrationId,
        discipline: "photography",
        file: FILE,
        replacesFileId: upload.fileId,
      })
    ).resolves.toEqual({ ok: false, error: "upload_limit" });
    await expect(
      teen.guardian.startEntryUpload({
        registrationId: teen.registrationId,
        discipline: "photography",
        file: FILE,
        restartPendingUpload: true,
      })
    ).resolves.toEqual({ ok: false, error: "upload_limit" });
    await expect(teen.guardian.completeEntryUpload(upload)).resolves.toEqual({
      ok: false,
      error: "file_not_found",
    });
    const completed = await app.completeEntryUpload(upload);
    expect(completed).toMatchObject({ ok: true, status: "processing" });
    if (!completed.ok) throw new Error(completed.error);
    const code = completed.entryCode;
    await h.drain();
    const subject = `Entry ${code} received for Seed competition 1`;
    expect(h.email.lastTo(teen.email)?.subject).toBe(subject);
    expect(await app.listInbox()).toContainEqual(
      expect.objectContaining({
        title: subject,
        body: expect.stringContaining(`We have received entry ${code}`),
      })
    );
    expect(h.email.inbox(teen.teenEmail)).not.toContainEqual(
      expect.objectContaining({ subject })
    );
    expect(await app.getEntry({ code })).toMatchObject({
      ok: true,
      entry: {
        code,
        whose: "mine",
        status: "submitted",
        uploadRule: { maxBytes: 20 * 1024 * 1024 },
      },
    });
    expect(await submittedImage(h, teen)).toBe(code);
  });
});

describe("entries for a guardian's ward", () => {
  it("refuses to attach a prepared upload when participation is withdrawn before acceptance", async () => {
    const h = await createHarness();
    const guardian = await confirmedChild(h);
    const app = h.as(guardian.actor);
    const upload = await putEntryImage(h, guardian);
    const consent = {
      childId: guardian.childId,
      competitionId: guardian.competition.id,
      purpose: "participation",
    } as const;
    const head = vi.spyOn(h.storage, "head");
    const client = h.db.$client;
    const transaction = client.transaction.bind(client);
    const prepare = vi
      .spyOn(client, "transaction")
      .mockImplementation(async (callback) => {
        const result = await transaction(callback);
        if (head.mock.calls.length > 0) {
          // The stored bytes have been checked and the preparation lock is
          // released. Record the guardian's decision before acceptance.
          prepare.mockRestore();
          await expect(app.withdrawChildConsent(consent)).resolves.toEqual({
            ok: true,
            changed: true,
          });
        }
        return result;
      });

    const completion = await app.completeEntryUpload(upload);
    expect(head).toHaveBeenCalledOnce();
    await h.drain();
    expect({
      completion,
      entries: await app.listMyEntries(),
      scanEvents: await h.db
        .select({ id: outbox.id })
        .from(outbox)
        .where(
          and(
            eq(outbox.aggregateId, upload.fileId),
            eq(outbox.eventType, "files.file_uploaded")
          )
        ),
      scans: h.scanner.scans,
    }).toEqual({
      completion: { ok: false, error: "participation_consent_required" },
      entries: [],
      scanEvents: [],
      scans: 0,
    });

    await expect(
      app.giveChildConsent({
        ...consent,
        documentId: guardian.competition.guardianDocuments.participation!,
      })
    ).resolves.toEqual({ ok: true, changed: true });
    await expect(app.completeEntryUpload(upload)).resolves.toMatchObject({
      ok: true,
      status: "processing",
    });
  });

  it("allows an accepted image to settle and replay after withdrawal while disabling replacements", async () => {
    const h = await createHarness();
    const guardian = await confirmedChild(h);
    const app = h.as(guardian.actor);
    const upload = await putEntryImage(h, guardian);
    const accepted = await app.completeEntryUpload(upload);
    if (!accepted.ok) throw new Error(accepted.error);
    const code = accepted.entryCode;
    await expect(
      app.withdrawChildConsent({
        childId: guardian.childId,
        competitionId: guardian.competition.id,
        purpose: "participation",
      })
    ).resolves.toEqual({ ok: true, changed: true });

    await h.drain();
    const detail = await app.getEntry({ code });
    if (!detail.ok) throw new Error(detail.error);
    expect(detail.entry.picture).toBeTruthy();
    expect(detail.entry.uploadRule).toBeNull();
    expect(await app.completeEntryUpload(upload)).toEqual({
      ok: true,
      entryCode: code,
      status: "submitted",
    });
    await h.drain();
    expect(h.scanner.scans).toBe(1);
  });

  it("refuses uploads, listings and detail delivery as soon as the guardian link is revoked", async () => {
    const h = await createHarness();
    const guardian = await confirmedChild(h);
    const code = await submittedImage(h, guardian);
    await h.drain();
    const app = h.as(guardian.actor);
    expect(await app.getEntry({ code })).toMatchObject({
      ok: true,
      entry: { picture: { url: expect.any(String) } },
    });
    const pending = await putEntryImage(h, guardian);

    await h.db
      .update(guardianLink)
      .set({ revokedAt: h.clock.now() })
      .where(eq(guardianLink.participantProfileId, guardian.childId));

    await expect(
      start(h, guardian.actor, guardian.registrationId)
    ).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(app.completeEntryUpload(pending)).rejects.toMatchObject({
      code: "forbidden",
    });
    expect(await app.listMyEntries()).toEqual([]);
    await expect(app.getEntry({ code })).rejects.toMatchObject({
      code: "forbidden",
    });
  });

  it("attaches nothing and dispatches no scan when the guardian link is revoked during storage preparation", async () => {
    const h = await createHarness();
    const guardian = await confirmedChild(h);
    const upload = await putEntryImage(h, guardian);
    const head = h.storage.head.bind(h.storage);
    let revocation: Promise<unknown> | undefined;
    const storageHead = vi
      .spyOn(h.storage, "head")
      .mockImplementationOnce((ref) => {
        // Queue the write during preparation. PGlite runs it as soon as the
        // preparation transaction releases its connection.
        revocation = h.db
          .update(guardianLink)
          .set({ revokedAt: h.clock.now() })
          .where(eq(guardianLink.participantProfileId, guardian.childId))
          .execute();
        return head(ref);
      });

    const completion = h.as(guardian.actor).completeEntryUpload(upload);
    try {
      await expect(completion).rejects.toMatchObject({ code: "forbidden" });
    } finally {
      await revocation;
    }

    expect(storageHead).toHaveBeenCalledOnce();
    expect(await h.db.select().from(entryFile)).toEqual([]);
    await h.drain();
    expect(h.scanner.scans).toBe(0);
  });

  it("refuses an unrelated entry before reading its private columns or files", async () => {
    const h = await createHarness();
    const guardian = await confirmedChild(h);
    const other = await confirmedAdult(h);
    const code = await submittedImage(h, guardian);

    await h.db.$client.exec(`
      CREATE ROLE entry_scope_reader;
      GRANT SELECT ON "participant_profile", "guardian", "guardian_link", "user_role"
        TO entry_scope_reader;
      GRANT SELECT ("code", "participant_profile_id") ON "entry"
        TO entry_scope_reader;
      SET ROLE entry_scope_reader;
    `);
    try {
      await expect(h.as(other.actor).getEntry({ code })).rejects.toMatchObject({
        code: "forbidden",
      });
    } finally {
      await h.db.$client.exec("RESET ROLE");
    }
  });

  it("lets the verified guardian submit for their child, see it as their child's, and open it", async () => {
    const h = await createHarness();
    const kavita = await confirmedChild(h);

    const code = await submittedImage(h, kavita);
    await h.drain();

    expect(await h.as(kavita.actor).listMyEntries()).toEqual([
      expect.objectContaining({
        code,
        status: "submitted",
        participantName: "Isha Desai",
        whose: "child",
      }),
    ]);
    const detail = await h.as(kavita.actor).getEntry({ code });
    expect(detail).toMatchObject({
      ok: true,
      entry: {
        code,
        whose: "child",
        participantName: "Isha Desai",
        title: ENTRY_TEXT.title,
        picture: { width: 1600, height: 1200 },
        uploadRule: { maxBytes: 20 * 1024 * 1024 },
      },
    });
    const [row] = await h.db.select().from(entry);
    expect(row).toMatchObject({ createdByUserId: kavita.userId });
  });

  it("refuses another child's guardian", async () => {
    const h = await createHarness();
    const kavita = await confirmedChild(h);
    const other = await confirmedChild(h, {
      name: "Sunita Rao",
      competition: kavita.competition,
    });
    const code = await submittedImage(h, kavita);

    await expect(start(h, other.actor, kavita.registrationId)).rejects.toThrow(
      DomainError
    );
    await expect(h.as(other.actor).getEntry({ code })).rejects.toThrow(
      DomainError
    );
    expect(await h.as(other.actor).listMyEntries()).toEqual([]);
  });

  it("serves only the live derivative through the guardian's entry and refuses Files delivery", async () => {
    const h = await createHarness();
    const guardian = await confirmedChild(h);
    const code = await submittedImage(h, guardian);
    await h.drain();
    await submittedImage(h, guardian, {
      bytes: readMediaFixture("rotatedJpeg"),
    });
    await h.drain();

    const detail = await h.as(guardian.actor).getEntry({ code });
    expect(detail).toMatchObject({
      ok: true,
      entry: { whose: "child", picture: { width: 400, height: 600 } },
    });
    if (!detail.ok || !detail.entry.picture) throw new Error("No live picture");
    const { url } = detail.entry.picture;
    expect(await h.storage.get(url)).toMatchObject({
      ok: true,
      cacheControl: "private, no-store",
    });
    h.clock.advance({ seconds: 301 });
    expect(await h.storage.get(url)).toEqual({ ok: false, error: "expired" });

    const staff = await signInStaff(h, "staff_admin");
    const superAdmin = await h.signIn(await h.seed.superAdmin());
    const files = await h.db.select().from(entryFile);
    expect(files.map(({ status }) => status)).toEqual(
      expect.arrayContaining(["superseded", "live"])
    );
    const decisions = await Promise.all(
      [guardian.actor, staff.actor, superAdmin].flatMap((actor) =>
        files.map(async ({ fileAssetId }) => {
          const request = h.as(actor).getFileDerivativeUrl({
            fileId: fileAssetId!,
            kind: "display_1600",
          });
          return request.then(
            (result) => (result.ok ? "signed" : result.error),
            (error: unknown) => {
              if (error instanceof DomainError) return error.code;
              throw error;
            }
          );
        })
      )
    );
    expect(decisions).toEqual([
      "forbidden",
      "forbidden",
      "not_found",
      "not_found",
      "not_found",
      "not_found",
    ]);
  });
});

describe("who may not submit or read an entry", () => {
  it("only shows a new upload form to the adult or guardian who can submit", async () => {
    const h = await createHarness();
    const child = await confirmedChild(h);
    const adult = await confirmedAdult(h, { competition: child.competition });
    const form = (registrationId: string) => ({ registrationId });

    await expect(
      h.as(adult.actor).getEntryUploadOptions(form(adult.registrationId))
    ).resolves.toMatchObject({
      ok: true,
      whose: "mine",
      disciplines: expect.arrayContaining(["drawing"]),
    });
    await expect(
      h.as(child.actor).getEntryUploadOptions(form(child.registrationId))
    ).resolves.toMatchObject({
      ok: true,
      whose: "child",
      participantName: "Isha Desai",
    });
    for (const actor of [adult.actor, h.visitor()]) {
      await expect(
        h.as(actor).getEntryUploadOptions(form(child.registrationId))
      ).rejects.toThrow(DomainError);
    }
  });

  it("refuses a competition manager, a coordinator and a visitor on an adult's registration", async () => {
    const h = await createHarness();
    const asha = await confirmedAdult(h);
    const code = await submittedImage(h, asha);
    const manager = await h.seed.member({ email: "manager@example.test" });
    await h.seed.grant(manager, {
      role: "competition_manager",
      scope: { type: "global" },
    });
    const school = await schoolWithStudents(h, {
      students: 1,
      code: "SKIES27",
    });

    for (const actor of [
      await h.signIn(manager),
      school.coordinator.actor,
      h.visitor(),
    ]) {
      await expect(start(h, actor, asha.registrationId)).rejects.toThrow(
        DomainError
      );
      await expect(h.as(actor).getEntry({ code })).rejects.toThrow(DomainError);
    }
  });

  it("refuses another participant's entry, and a code that names none, the same way", async () => {
    const h = await createHarness();
    const asha = await confirmedAdult(h);
    const ravi = await confirmedAdult(h, {
      competition: asha.competition,
      name: "Ravi Kumar",
    });
    const code = await submittedImage(h, asha);

    await expect(h.as(ravi.actor).getEntry({ code })).rejects.toThrow(
      DomainError
    );
    await expect(
      h.as(asha.actor).getEntry({ code: `${asha.competition.code}-E-000000` })
    ).rejects.toThrow(DomainError);
    await expect(
      h.as(asha.actor).getEntry({ code: "not an entry" })
    ).rejects.toThrow(DomainError);
  });

  it("refuses a school's student's registration to a participant, a competition manager and another school's coordinator", async () => {
    const h = await createHarness();
    const school = await schoolWithStudents(h, { students: 1, feePaise: 0n });
    await school.pay();
    const other = await schoolWithStudents(h, {
      students: 1,
      code: "SKIES27",
      name: "Other School",
    });
    const asha = await confirmedAdult(h);
    const manager = await signInStaff(h, "competition_manager");

    for (const actor of [other.coordinator.actor, asha.actor, manager.actor]) {
      await expect(
        start(h, actor, school.registrationIds[0]!)
      ).rejects.toMatchObject({ code: "forbidden" });
    }
  });
});
