import { asc, eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import type { Actor } from "@/server/actor";
import {
  auditLog,
  entry,
  entryFile,
  entryTransition,
  fileAsset,
} from "@/server/db/schema";
import { DomainError } from "@/server/errors";
import { signInStaff } from "@/server/modules/payments/testing";
import { drainUntilIdle } from "@/server/outbox";
import { EICAR_TEST_BYTES } from "@/test/eicar";
import { createHarness, type Harness } from "@/test/harness";
import { readMediaFixture } from "@/test/media-fixtures";

import { applyEntryFileOutcome } from "../apply-file-outcome";
import {
  confirmedAdult,
  confirmedChild,
  ENTRY_TEXT,
  PHOTO,
  putEntryImage,
  submittedImage,
} from "../testing";

// #85: what an upload's checks do to its entry. The scan, then the media
// job, run as the worker runs them (h.drain(), with the scanner, storage
// and media fakes): a clean picture whose derivatives are made submits the
// entry and its participant (or their guardian) is told; an infected one
// rejects it; one that can't be opened fails it; either can be retried
// before the deadline. Staff never see an entry before its file has passed.

const MANAGER_EMAIL = "manager@example.test";
const MISSING_FILE_ID = "00000000-0000-4000-8000-000000000001";

async function competitionManager(h: Harness, competitionId: string) {
  const manager = await h.seed.member({ email: MANAGER_EMAIL });
  await h.seed.grant(manager, {
    role: "competition_manager",
    scope: { type: "competition", id: competitionId },
  });
  return h.signIn(manager);
}

async function entryRow(h: Harness) {
  const [row] = await h.db.select().from(entry);
  return row!;
}

async function staffCodes(h: Harness, manager: Actor, competitionId: string) {
  const entries = await h.as(manager).listCompetitionEntries({ competitionId });
  if (!Array.isArray(entries)) throw new Error(JSON.stringify(entries));
  return entries.map((each) => each.code);
}

async function uploadReference(h: Harness, fileId: string) {
  const [attempt] = await h.db
    .select({ id: entryFile.id })
    .from(entryFile)
    .where(eq(entryFile.fileAssetId, fileId));
  if (!attempt) throw new Error("Missing entry upload attempt");
  return attempt.id;
}

describe("an entry's file checks", () => {
  it("submits the entry once its picture is clean and processed, and tells the participant", async () => {
    const h = await createHarness();
    const asha = await confirmedAdult(h);
    const code = await submittedImage(h, asha);

    await h.drain();

    expect(await entryRow(h)).toMatchObject({
      code,
      status: "submitted",
      submittedAt: h.clock.now(),
    });
    const [list] = await h.as(asha.actor).listMyEntries();
    expect(list).toMatchObject({ code, status: "submitted", checking: false });
    const sent = h.email.sent.filter(
      (mail) => mail.to === asha.email && mail.subject.includes(code)
    );
    expect(sent.map((mail) => mail.subject)).toEqual([
      `Entry ${code} received for Seed competition 1`,
    ]);
    expect(sent[0]!.text).toContain("The dog at the tea stall");
    expect(h.media.processed).toHaveLength(1);
  });

  it("keeps the dashboard status and checking flag in sync during first-file settlement", async () => {
    const h = await createHarness();
    const asha = await confirmedAdult(h);
    const app = h.as(asha.actor);
    const code = await submittedImage(h, asha);
    const client = h.db.$client;
    const query = client.query.bind(client);
    const read = vi
      .spyOn(client, "query")
      .mockImplementation(async (...args) => {
        const result = await query(...args);
        if (args[0].includes('from "entry" inner join "competition"')) {
          // Settle after the database has read the entry but before the list
          // receives those rows. Both operations use the real database.
          read.mockRestore();
          await h.drain();
        }
        return result;
      });

    const duringSettlement = await app.listMyEntries();
    expect(duringSettlement).toMatchObject([
      { code, status: "processing", checking: true, submittedAt: null },
    ]);
    expect(await app.listMyEntries()).toMatchObject([
      {
        code,
        status: "submitted",
        checking: false,
        submittedAt: h.clock.now(),
      },
    ]);
  });

  it("retries a receipt with the submitted image's title and reference after replacement", async () => {
    const h = await createHarness();
    const asha = await confirmedAdult(h);
    const app = h.as(asha.actor);
    await h.drain();

    const upload = await putEntryImage(h, asha);
    const completion = await app.completeEntryUpload(upload);
    if (!completion.ok) throw new Error(completion.error);
    const { entryCode: code } = completion;
    const reference = await uploadReference(h, upload.fileId);
    const subject = `Entry ${code} received for Seed competition 1`;

    h.email.failNext(1);
    await h.drain();
    expect(h.email.inbox(asha.email)).not.toContainEqual(
      expect.objectContaining({ subject })
    );
    const newTitle = "Late afternoon in the courtyard";
    await submittedImage(h, asha, {
      text: { ...ENTRY_TEXT, title: newTitle },
    });
    await h.drain();
    expect(await app.getEntry({ code })).toMatchObject({
      ok: true,
      entry: { title: newTitle },
    });
    h.clock.advance({ seconds: 30 });
    await h.drain();

    const emails = h.email
      .inbox(asha.email)
      .filter((mail) => mail.subject === subject);
    expect(emails).toHaveLength(1);
    expect(emails[0]?.text).toContain(upload.title);
    expect(emails[0]?.text).toContain(reference);
    expect(emails[0]?.text).not.toContain(newTitle);
  });

  it.each([
    { attempt: "first upload", rejected: true },
    { attempt: "first upload", rejected: false },
    { attempt: "replacement", rejected: true },
    { attempt: "replacement", rejected: false },
  ])(
    "keeps the $attempt failure notice tied to its attempt after a later upload succeeds (rejected=$rejected)",
    async ({ attempt, rejected }) => {
      const h = await createHarness();
      const asha = await confirmedAdult(h);
      const app = h.as(asha.actor);
      if (attempt === "replacement") await submittedImage(h, asha);
      await h.drain();

      const upload = await putEntryImage(h, asha, {
        bytes: rejected ? EICAR_TEST_BYTES : readMediaFixture("corruptJpeg"),
        text: { ...ENTRY_TEXT, title: "An image that did not pass" },
      });
      const completion = await app.completeEntryUpload(upload);
      if (!completion.ok) throw new Error(completion.error);
      const { entryCode: code } = completion;
      const reference = await uploadReference(h, upload.fileId);
      const subject = rejected
        ? `We couldn't accept the file for ${code}`
        : `We couldn't open the file for ${code}`;
      h.email.failNext(1);
      await h.drain();
      const inbox = (await app.listInbox()).find(
        (item) => item.title === subject
      );
      expect(inbox).toBeDefined();
      expect(h.email.inbox(asha.email)).not.toContainEqual(
        expect.objectContaining({ subject })
      );

      const newTitle = "Late afternoon in the courtyard";
      expect(
        await submittedImage(h, asha, {
          text: { ...ENTRY_TEXT, title: newTitle },
        })
      ).toBe(code);
      await h.drain();
      expect(await app.getEntry({ code })).toMatchObject({
        ok: true,
        entry: { status: "submitted", title: newTitle },
      });
      h.clock.advance({ seconds: 30 });
      await h.drain();

      const emails = h.email
        .inbox(asha.email)
        .filter((mail) => mail.subject === subject);
      expect(emails).toHaveLength(1);
      expect(emails[0]?.text).not.toContain(newTitle);
      for (const body of [inbox?.body, emails[0]?.text, emails[0]?.html]) {
        expect(body).toContain(code);
        expect(body).toContain(reference);
      }
      expect(
        (await app.listInbox()).filter((item) => item.title === subject)
      ).toHaveLength(1);
    }
  );

  it.each([
    {
      status: "submitted",
      subject: "received for Seed competition 1",
      bytes: PHOTO,
    },
    {
      status: "rejected",
      subject: "We couldn't accept the file for",
      bytes: PHOTO,
    },
    {
      status: "failed",
      subject: "We couldn't open the file for",
      bytes: readMediaFixture("corruptJpeg"),
    },
  ])(
    "sends the guardian a private $status notice by email and in-app",
    async ({ status, subject, bytes }) => {
      const h = await createHarness();
      const guardian = await confirmedChild(h);
      if (status === "rejected") {
        vi.spyOn(h.scanner, "scan").mockResolvedValueOnce({
          verdict: "infected",
          signature: "fixture verdict",
        });
      }
      const text = {
        title: "My entry title",
        description: "My private description",
        statement: "My private statement",
      };
      const code = await submittedImage(h, guardian, { bytes, text });

      await h.drain();

      expect((await entryRow(h)).status).toBe(status);
      const expectedSubject =
        status === "submitted"
          ? `Entry ${code} ${subject}`
          : `${subject} ${code}`;
      const mail = h.email.lastTo(guardian.email);
      const inbox = (await h.as(guardian.actor).listInbox()).find(
        (item) => item.title === expectedSubject
      );
      expect(mail).toMatchObject({ subject: expectedSubject });
      expect(inbox).toMatchObject({ title: expectedSubject });
      const copy = [mail?.text, mail?.html, inbox?.body].join("\n");
      expect(copy).toContain("Seed competition 1");
      for (const identifyingText of ["Isha Desai", ...Object.values(text)]) {
        expect(copy).not.toContain(identifyingText);
      }
      expect(await h.as(guardian.actor).getEntry({ code })).toMatchObject({
        ok: true,
        entry: { participantName: "Isha Desai", ...text },
      });
    }
  );

  it("accepts a HEIC photo the browser gave no type, and makes its copies", async () => {
    const h = await createHarness();
    const asha = await confirmedAdult(h);
    const heic = readMediaFixture("iphoneHeic");

    const code = await submittedImage(h, asha, {
      bytes: heic,
      name: "IMG_0042.HEIC",
      type: "",
    });
    await h.drain();

    expect(await entryRow(h)).toMatchObject({ code, status: "submitted" });
    expect(h.media.processed).toHaveLength(1);
    const detail = await h.as(asha.actor).getEntry({ code });
    expect(detail).toMatchObject({
      ok: true,
      entry: { picture: { width: 700, height: 1100 } },
    });
  });

  it("keeps the entry from staff until its file has passed", async () => {
    const h = await createHarness();
    const asha = await confirmedAdult(h);
    const manager = await competitionManager(h, asha.competition.id);
    const code = await submittedImage(h, asha);

    expect(await staffCodes(h, manager, asha.competition.id)).toEqual([]);
    await h.drain();

    expect(await staffCodes(h, manager, asha.competition.id)).toEqual([code]);
  });

  it("keeps the original private from both the uploader and staff", async () => {
    const h = await createHarness();
    const asha = await confirmedAdult(h);
    const admin = await h.signIn(await h.seed.superAdmin());
    const code = await submittedImage(h, asha);
    const [file] = await h.db.select().from(fileAsset);
    if (!file) throw new Error("Missing entry upload");
    const original = { fileId: file.id };

    async function downloadOutcome(actor: Actor, input = original) {
      try {
        const result = await h.as(actor).getFileDownloadUrl(input);
        return result.ok ? "signed" : result.error;
      } catch (error) {
        if (error instanceof DomainError) return error.code;
        throw error;
      }
    }

    const whileScanning = await downloadOutcome(asha.actor);
    await drainUntilIdle(h.deps);
    expect(h.media.processed).toHaveLength(0);
    const beforeProcessing = await downloadOutcome(admin);
    await h.drain();
    const afterProcessing = await downloadOutcome(admin);

    expect({ whileScanning, beforeProcessing, afterProcessing }).toEqual({
      whileScanning: "forbidden",
      beforeProcessing: "not_found",
      afterProcessing: "not_found",
    });
    expect(await downloadOutcome(admin, { fileId: MISSING_FILE_ID })).toBe(
      afterProcessing
    );
    const detail = await h.as(asha.actor).getEntry({ code });
    if (!detail.ok || !detail.entry.picture) throw new Error("No live copy");
    expect(await h.storage.get(detail.entry.picture.url)).toMatchObject({
      ok: true,
      contentType: "image/webp",
    });
  });

  it("keeps an entry image's scan status out of the generic Files lookup", async () => {
    const h = await createHarness();
    const asha = await confirmedAdult(h);
    const staff = await signInStaff(h, "staff_admin");
    const admin = await h.signIn(await h.seed.superAdmin());
    const upload = await putEntryImage(h, asha);
    const input = { fileId: upload.fileId };
    await expect(
      h.as(asha.actor).completeEntryUpload(upload)
    ).resolves.toMatchObject({
      ok: true,
      status: "processing",
    });

    const missing = { fileId: MISSING_FILE_ID };
    for (const actor of [staff.actor, admin]) {
      const files = h.as(actor);
      const absent = await files.getFileStatus(missing);
      expect(absent).toEqual({ ok: false, error: "not_found" });
      await expect(files.getFileStatus(input)).resolves.toEqual(absent);
    }
    for (const target of [input, missing]) {
      await expect(
        h.as(asha.actor).getFileStatus(target)
      ).rejects.toMatchObject({ code: "forbidden" });
    }
    await h.drain();
    await expect(h.as(staff.actor).getFileStatus(input)).resolves.toEqual({
      ok: false,
      error: "not_found",
    });
  });

  it("rejects the entry when its first file is infected, tells the participant, and keeps it from staff", async () => {
    const h = await createHarness();
    const asha = await confirmedAdult(h);
    const manager = await competitionManager(h, asha.competition.id);
    const code = await submittedImage(h, asha, { bytes: EICAR_TEST_BYTES });

    await h.drain();

    expect(await entryRow(h)).toMatchObject({
      status: "rejected",
      submittedAt: null,
    });
    expect(h.email.lastTo(asha.email)?.subject).toBe(
      `We couldn't accept the file for ${code}`
    );
    expect(h.email.lastTo(asha.email)?.text).toContain("virus check");
    expect(await staffCodes(h, manager, asha.competition.id)).toEqual([]);
    expect(h.media.processed).toEqual([]);
  });

  it("tells the guardian their upload was rejected when the file is kept in quarantine", async () => {
    const h = await createHarness();
    const guardian = await confirmedChild(h);
    vi.spyOn(h.scanner, "scan").mockResolvedValueOnce({
      verdict: "infected",
      signature: "fixture verdict",
    });
    const code = await submittedImage(h, guardian);

    await h.drain();

    expect((await entryRow(h)).status).toBe("rejected");
    const [file] = await h.db.select().from(fileAsset);
    if (!file) throw new Error("Missing entry upload");
    expect(file.status).toBe("quarantined");
    expect(file.storageKey).toContain("/quarantine/");
    expect(
      await h.storage.head({ bucket: file.bucket, key: file.storageKey })
    ).toEqual({ contentType: "image/jpeg", sizeBytes: PHOTO.length });
    const mail = h.email.lastTo(guardian.email);
    expect(mail?.subject).toBe(`We couldn't accept the file for ${code}`);
    expect(mail?.text).not.toMatch(/\bdeleted\b/i);
    expect(mail?.text).toContain(
      "didn't pass our virus check and was rejected"
    );
    expect(mail?.text).toContain("upload a clean copy");
  });

  it("fails the entry when its picture can't be opened, and tells the participant", async () => {
    const h = await createHarness();
    const asha = await confirmedAdult(h);
    const manager = await competitionManager(h, asha.competition.id);
    const code = await submittedImage(h, asha, {
      bytes: readMediaFixture("corruptJpeg"),
    });

    await h.drain();

    expect((await entryRow(h)).status).toBe("failed");
    expect(h.email.lastTo(asha.email)?.subject).toBe(
      `We couldn't open the file for ${code}`
    );
    expect(await staffCodes(h, manager, asha.competition.id)).toEqual([]);
  });

  it("fails the entry when the file isn't the picture it was declared as", async () => {
    const h = await createHarness();
    const asha = await confirmedAdult(h);
    const pdf = new TextEncoder().encode("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n");

    await submittedImage(h, asha, {
      bytes: pdf,
      name: "work.png",
      type: "image/png",
    });
    await h.drain();

    expect((await entryRow(h)).status).toBe("failed");
  });

  it.each([
    { status: "rejected", bytes: EICAR_TEST_BYTES },
    { status: "failed", bytes: readMediaFixture("corruptJpeg") },
  ])(
    "takes a retry after a $status file, back through processing to submitted",
    async ({ status, bytes }) => {
      const h = await createHarness();
      const asha = await confirmedAdult(h);
      const code = await submittedImage(h, asha, { bytes });
      await h.drain();
      expect((await entryRow(h)).status).toBe(status);

      h.clock.advance({ minutes: 5 });
      const retried = await submittedImage(h, asha);
      expect(retried).toBe(code);
      expect((await entryRow(h)).status).toBe("processing");
      await h.drain();

      expect((await entryRow(h)).status).toBe("submitted");
      const files = await h.db
        .select({ status: entryFile.status })
        .from(entryFile)
        .orderBy(asc(entryFile.id));
      expect(files.map((file) => file.status)).toEqual([status, "live"]);
    }
  );

  it("replays completion after the scan rejects the already attached file", async () => {
    const h = await createHarness();
    const asha = await confirmedAdult(h);
    const app = h.as(asha.actor);
    const request = await putEntryImage(h, asha, {
      bytes: PHOTO,
      name: "work.png",
      type: "image/png",
    });
    const completion = await app.completeEntryUpload(request);
    if (!completion.ok) throw new Error(completion.error);
    expect(completion.status).toBe("processing");
    await h.drain();
    const notices = h.email.sent.length;

    h.clock.advance({ minutes: 11 });
    await h.drain();

    const [asset] = await h.db
      .select()
      .from(fileAsset)
      .where(eq(fileAsset.id, request.fileId));
    expect(asset?.status).toBe("rejected");
    const replay = await app.completeEntryUpload({
      ...request,
      title: "A later edit",
    });
    expect(replay).toEqual({
      ok: true,
      entryCode: completion.entryCode,
      status: "failed",
    });
    expect(await app.listMyEntries()).toMatchObject([
      { code: completion.entryCode, title: request.title, status: "failed" },
    ]);
    expect(await h.db.select().from(entryFile)).toHaveLength(1);
    await h.drain();
    expect(h.email.sent).toHaveLength(notices);
  });

  it("keeps each status change in the entry's history and the audit log", async () => {
    const h = await createHarness();
    const asha = await confirmedAdult(h);
    await submittedImage(h, asha, { bytes: EICAR_TEST_BYTES });
    await h.drain();
    await submittedImage(h, asha);
    await h.drain();
    const { id } = await entryRow(h);

    const history = await h.db
      .select({
        from: entryTransition.fromStatus,
        to: entryTransition.toStatus,
        trigger: entryTransition.trigger,
        actorKind: entryTransition.actorKind,
        actorUserId: entryTransition.actorUserId,
      })
      .from(entryTransition)
      .where(eq(entryTransition.entryId, id))
      .orderBy(asc(entryTransition.id));
    expect(history).toEqual([
      {
        from: null,
        to: "processing",
        trigger: "upload_completed",
        actorKind: "user",
        actorUserId: asha.userId,
      },
      {
        from: "processing",
        to: "rejected",
        trigger: "file_infected",
        actorKind: "system",
        actorUserId: null,
      },
      {
        from: "rejected",
        to: "processing",
        trigger: "upload_retried",
        actorKind: "user",
        actorUserId: asha.userId,
      },
      {
        from: "processing",
        to: "submitted",
        trigger: "file_live",
        actorKind: "system",
        actorUserId: null,
      },
    ]);
    const audit = await h.db
      .select({ action: auditLog.action })
      .from(auditLog)
      .where(eq(auditLog.entityId, id))
      .orderBy(asc(auditLog.id));
    expect(audit.map((row) => row.action)).toEqual([
      "entry.created",
      "entry.rejected",
      "entry.retried",
      "entry.submitted",
    ]);
  });

  it("is safe to deliver again: a repeated outcome changes nothing and sends nothing", async () => {
    const h = await createHarness();
    const asha = await confirmedAdult(h);
    await submittedImage(h, asha);
    await h.drain();
    const before = {
      entry: await entryRow(h),
      history: await h.db.select().from(entryTransition),
      mails: h.email.sent.length,
    };
    const [file] = await h.db.select().from(entryFile);

    await applyEntryFileOutcome(h.deps, { fileId: file!.fileAssetId! });
    await h.drain();

    expect(await entryRow(h)).toEqual(before.entry);
    expect(await h.db.select().from(entryTransition)).toEqual(before.history);
    expect(h.email.sent).toHaveLength(before.mails);
  });
});

describe("listCompetitionEntries", () => {
  it("checks staff scope and session before returning malformed input diagnostics", async () => {
    const h = await createHarness();
    const asha = await confirmedAdult(h);
    const scoped = await competitionManager(h, asha.competition.id);
    const input = { competitionId: "invalid" };
    for (const actor of [h.visitor(), asha.actor, scoped]) {
      await expect(
        h.as(actor).listCompetitionEntries(input)
      ).rejects.toMatchObject({
        code: "forbidden",
      });
    }

    const manager = await h.seed.member({ email: "global@example.test" });
    await h.seed.grant(manager, {
      role: "competition_manager",
      scope: { type: "global" },
    });
    const ready = await h.signIn(manager);
    const pending = await h.signIn(manager, undefined, { secondFactor: false });
    await expect(
      h.as(pending).listCompetitionEntries(input)
    ).rejects.toMatchObject({
      code: "second_factor_required",
    });
    await expect(
      h.as(ready).listCompetitionEntries(input)
    ).resolves.toMatchObject({
      error: "invalid_input",
    });
  });

  it("requires the same-competition manager's second factor", async () => {
    const h = await createHarness();
    const asha = await confirmedAdult(h);
    const manager = await h.seed.member({ email: MANAGER_EMAIL });
    const scope = { type: "competition", id: asha.competition.id } as const;
    await h.seed.grant(manager, { role: "competition_manager", scope });
    const ready = await h.signIn(manager);
    const pending = await h.signIn(manager, undefined, { secondFactor: false });
    const input = { competitionId: asha.competition.id };
    await expect(
      h.as(pending).listCompetitionEntries(input)
    ).rejects.toMatchObject({
      code: "second_factor_required",
    });
    await expect(h.as(ready).listCompetitionEntries(input)).resolves.toEqual(
      []
    );
  });

  it("lets a competition manager of that competition, or a global one, list it", async () => {
    const h = await createHarness();
    const asha = await confirmedAdult(h);
    const code = await submittedImage(h, asha);
    await h.drain();
    const global = await h.seed.member({ email: "global@example.test" });
    await h.seed.grant(global, {
      role: "competition_manager",
      scope: { type: "global" },
    });

    expect(
      await h
        .as(await h.signIn(global))
        .listCompetitionEntries({ competitionId: asha.competition.id })
    ).toEqual([
      {
        code,
        title: "The dog at the tea stall",
        discipline: "photography",
        status: "submitted",
        submittedAt: h.clock.now(),
      },
    ]);
  });

  it("refuses a manager of another competition, a participant and a visitor", async () => {
    const h = await createHarness();
    const asha = await confirmedAdult(h);
    const other = await confirmedAdult(h, { name: "Ravi Kumar" });
    const elsewhere = await competitionManager(h, other.competition.id);
    const input = { competitionId: asha.competition.id };

    for (const actor of [elsewhere, asha.actor, h.visitor()]) {
      await expect(h.as(actor).listCompetitionEntries(input)).rejects.toThrow(
        DomainError
      );
    }
  });
});
