import { asc, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { createApp } from "@/server/app";
import { auditLog, entry, entryFile, fileAsset } from "@/server/db/schema";
import { EICAR_TEST_BYTES } from "@/test/eicar";
import { FakeClock } from "@/test/fakes/clock";
import { createHarness, type Harness } from "@/test/harness";
import { readMediaFixture } from "@/test/media-fixtures";

import {
  confirmedAdult,
  ENTRY_TEXT,
  PHOTO,
  putEntryImage,
  submitImage,
  submittedImage,
  type Participant,
} from "../testing";

// #85: replacing an entry's picture before the deadline. A replacement is
// pending: the entry stays submitted and keeps showing its current picture
// until the new one has passed its checks; one that fails them changes
// nothing but a message. Uploads stop at the deadline; one completed before
// it still counts when its checks finish after.

const PORTRAIT = readMediaFixture("rotatedJpeg");
const ORIGINAL_TEXT = { ...ENTRY_TEXT, statement: "A scene from my street." };
const REPLACEMENT_TEXT = {
  title: "A portrait in sunlight",
  description: "The dog is sitting in the sun.",
};

async function fileStatuses(h: Harness) {
  const rows = await h.db
    .select({ status: entryFile.status })
    .from(entryFile)
    .orderBy(asc(entryFile.id));
  return rows.map((row) => row.status);
}

function fileAudit(h: Harness) {
  return h.db
    .select({
      fileId: auditLog.entityId,
      before: auditLog.before,
      after: auditLog.after,
      actorKind: auditLog.actorKind,
    })
    .from(auditLog)
    .where(eq(auditLog.entityType, "entry_file"))
    .orderBy(asc(auditLog.id));
}

async function entryStatus(h: Harness) {
  const [row] = await h.db.select({ status: entry.status }).from(entry);
  return row?.status;
}

async function picture(h: Harness, who: Participant, code: string) {
  const result = await h.as(who.actor).getEntry({ code });
  if (!result.ok) throw new Error(JSON.stringify(result));
  return result.entry.picture;
}

/** The closing instant of the participant's competition. */
async function closesAt(h: Harness, who: Participant, code: string) {
  const result = await h.as(who.actor).getEntry({ code });
  if (!result.ok || !result.entry.closesAt) throw new Error("No deadline");
  return result.entry.closesAt;
}

describe("replacing an entry's picture", () => {
  it("keeps the submitted picture and text until the replacement goes live", async () => {
    const h = await createHarness();
    const asha = await confirmedAdult(h);
    const code = await submittedImage(h, asha, { text: ORIGINAL_TEXT });
    await h.drain();
    const auditBefore = await fileAudit(h);
    const first = await picture(h, asha, code);
    expect(first).toMatchObject({ width: 1600, height: 1200 });

    const replaced = await submitImage(h, asha, {
      bytes: PORTRAIT,
      text: REPLACEMENT_TEXT,
    });

    expect(replaced).toEqual({
      ok: true,
      entryCode: code,
      status: "submitted",
    });
    expect(await fileStatuses(h)).toEqual(["live", "pending"]);
    const during = await h.as(asha.actor).getEntry({ code });
    expect(during).toMatchObject({
      ok: true,
      entry: {
        ...ORIGINAL_TEXT,
        status: "submitted",
        latestUpload: "pending",
        picture: { width: 1600, height: 1200 },
      },
    });
    const mailsBefore = h.email.sent.length;

    await h.drain();

    expect(await entryStatus(h)).toBe("submitted");
    expect(await fileStatuses(h)).toEqual(["superseded", "live"]);
    expect(await picture(h, asha, code)).toMatchObject({
      width: 400,
      height: 600,
    });
    expect(await h.as(asha.actor).getEntry({ code })).toMatchObject({
      ok: true,
      entry: { ...REPLACEMENT_TEXT, statement: null },
    });
    // No second "received": the entry was submitted already.
    expect(h.email.sent).toHaveLength(mailsBefore);
    const [original, replacement] = await h.db
      .select()
      .from(entryFile)
      .orderBy(asc(entryFile.id));
    const { entryId } = replacement!;
    expect((await fileAudit(h)).slice(auditBefore.length)).toEqual([
      {
        fileId: replacement!.id,
        actorKind: "user",
        before: { status: null },
        after: { entryId, status: "pending" },
      },
      {
        fileId: replacement!.id,
        actorKind: "system",
        before: { status: "pending" },
        after: { entryId, status: "processing" },
      },
      {
        fileId: original!.id,
        actorKind: "system",
        before: { status: "live" },
        after: { entryId, status: "superseded" },
      },
      {
        fileId: replacement!.id,
        actorKind: "system",
        before: { status: "processing" },
        after: { entryId, status: "live" },
      },
    ]);
  });

  it("shows a pending replacement accepted on an app with a slower clock", async () => {
    const h = await createHarness();
    const asha = await confirmedAdult(h);
    const code = await submittedImage(h, asha, { text: ORIGINAL_TEXT });
    await h.drain();

    const clock = new FakeClock(new Date(h.clock.now().getTime() - 1_000));
    const slowerApp = createApp({ ...h.deps, clock });
    const upload = await putEntryImage(
      { ...slowerApp, storage: h.storage },
      asha,
      {
        bytes: PORTRAIT,
        text: REPLACEMENT_TEXT,
      }
    );
    await expect(
      slowerApp.as(asha.actor).completeEntryUpload(upload)
    ).resolves.toEqual({
      ok: true,
      entryCode: code,
      status: "submitted",
    });

    await expect(h.as(asha.actor).getEntry({ code })).resolves.toMatchObject({
      ok: true,
      entry: {
        ...ORIGINAL_TEXT,
        latestUpload: "pending",
        picture: { width: 1600, height: 1200 },
      },
    });
  });

  it("keeps the current picture when the replacement is infected, and says so", async () => {
    const h = await createHarness();
    const asha = await confirmedAdult(h);
    const code = await submittedImage(h, asha, { text: ORIGINAL_TEXT });
    await h.drain();
    const auditBefore = await fileAudit(h);

    await submittedImage(h, asha, {
      bytes: EICAR_TEST_BYTES,
      text: REPLACEMENT_TEXT,
    });
    await h.drain();

    expect(await entryStatus(h)).toBe("submitted");
    expect(await fileStatuses(h)).toEqual(["live", "rejected"]);
    expect(await picture(h, asha, code)).toMatchObject({ width: 1600 });
    expect(h.email.lastTo(asha.email)?.subject).toBe(
      `We couldn't accept the file for ${code}`
    );
    const detail = await h.as(asha.actor).getEntry({ code });
    expect(detail).toMatchObject({
      ok: true,
      entry: { ...ORIGINAL_TEXT, latestUpload: "rejected" },
    });
    const [, replacement] = await h.db
      .select()
      .from(entryFile)
      .orderBy(asc(entryFile.id));
    const { id: fileId, entryId } = replacement!;
    expect((await fileAudit(h)).slice(auditBefore.length)).toEqual([
      {
        fileId,
        actorKind: "user",
        before: { status: null },
        after: { entryId, status: "pending" },
      },
      {
        fileId,
        actorKind: "system",
        before: { status: "pending" },
        after: { entryId, status: "rejected" },
      },
    ]);
  });

  it("keeps the current picture when the replacement can't be opened, and says so", async () => {
    const h = await createHarness();
    const asha = await confirmedAdult(h);
    const code = await submittedImage(h, asha, { text: ORIGINAL_TEXT });
    await h.drain();

    await submittedImage(h, asha, {
      bytes: readMediaFixture("corruptJpeg"),
      text: REPLACEMENT_TEXT,
    });
    await h.drain();

    expect(await entryStatus(h)).toBe("submitted");
    expect(await fileStatuses(h)).toEqual(["live", "failed"]);
    expect(h.email.lastTo(asha.email)?.subject).toBe(
      `We couldn't open the file for ${code}`
    );
    expect(await h.as(asha.actor).getEntry({ code })).toMatchObject({
      ok: true,
      entry: {
        ...ORIGINAL_TEXT,
        latestUpload: "failed",
        picture: { width: 1600 },
      },
    });
  });

  it("clears an earlier failure when a replacement accepted on a slower clock goes live", async () => {
    const h = await createHarness();
    const asha = await confirmedAdult(h);
    const code = await submittedImage(h, asha, { text: ORIGINAL_TEXT });
    await h.drain();
    await submittedImage(h, asha, { bytes: readMediaFixture("corruptJpeg") });
    await h.drain();
    const app = h.as(asha.actor);
    expect(await app.getEntry({ code })).toMatchObject({
      ok: true,
      entry: { latestUpload: "failed" },
    });

    const clock = new FakeClock(new Date(h.clock.now().getTime() - 10));
    const slowerApp = createApp({ ...h.deps, clock });
    const upload = await putEntryImage(
      { ...slowerApp, storage: h.storage },
      asha,
      {
        bytes: PORTRAIT,
        text: REPLACEMENT_TEXT,
      }
    );
    await expect(
      slowerApp.as(asha.actor).completeEntryUpload(upload)
    ).resolves.toEqual({
      ok: true,
      entryCode: code,
      status: "submitted",
    });
    await h.drain();

    expect(await app.listMyEntries()).toMatchObject([
      { code, checking: false },
    ]);
    expect(await app.getEntry({ code })).toMatchObject({
      ok: true,
      entry: {
        ...REPLACEMENT_TEXT,
        status: "submitted",
        picture: { width: 400, height: 600 },
        latestUpload: null,
      },
    });
  });

  it("drops an upload still being checked when a newer one completes, whatever its outcome then", async () => {
    const h = await createHarness();
    const asha = await confirmedAdult(h);
    const code = await submittedImage(h, asha, { text: ORIGINAL_TEXT });
    await h.drain();

    await submittedImage(h, asha, {
      bytes: EICAR_TEST_BYTES,
      text: { title: "Earlier attempt", description: "A discarded draft." },
    });
    await submittedImage(h, asha, { bytes: PORTRAIT, text: REPLACEMENT_TEXT });
    expect(await fileStatuses(h)).toEqual(["live", "superseded", "pending"]);
    expect(await h.as(asha.actor).getEntry({ code })).toMatchObject({
      ok: true,
      entry: ORIGINAL_TEXT,
    });
    const mailsBefore = h.email.sent.length;
    await h.drain();

    // The dropped one's verdict came in, and changed nothing.
    expect(await fileStatuses(h)).toEqual(["superseded", "superseded", "live"]);
    expect(await picture(h, asha, code)).toMatchObject({ width: 400 });
    expect(await h.as(asha.actor).getEntry({ code })).toMatchObject({
      ok: true,
      entry: REPLACEMENT_TEXT,
    });
    expect(h.email.sent).toHaveLength(mailsBefore);
  });

  it("replaces a first file still being checked: the newer one decides", async () => {
    const h = await createHarness();
    const asha = await confirmedAdult(h);
    await submittedImage(h, asha, { bytes: EICAR_TEST_BYTES });
    await submittedImage(h, asha);

    await h.drain();

    expect(await entryStatus(h)).toBe("submitted");
    expect(await fileStatuses(h)).toEqual(["superseded", "live"]);
  });
});

describe("the submission deadline", () => {
  it("lets a reopened replacement form finish before closing", async () => {
    const h = await createHarness();
    const asha = await confirmedAdult(h);
    const code = await submittedImage(h, asha, { text: ORIGINAL_TEXT });
    await h.drain();
    const deadline = await closesAt(h, asha, code);
    h.clock.set(new Date(deadline.getTime() - 60_000));
    const app = h.as(asha.actor);
    const first = await app.startEntryUpload({
      registrationId: asha.registrationId,
      file: { name: "first.jpg", type: "image/jpeg", size: PHOTO.length },
    });
    if (!first.ok) throw new Error(first.error);
    expect(first.expiresAt.getTime()).toBeGreaterThan(deadline.getTime());

    h.clock.advance({ seconds: 5 });
    const reopened = h.as(asha.actor);
    expect(await reopened.getEntry({ code })).toMatchObject({
      ok: true,
      entry: { status: "submitted", uploadRule: expect.any(Object) },
    });
    const input = {
      registrationId: asha.registrationId,
      restartPendingUpload: true,
      file: { name: "second.jpg", type: "image/jpeg", size: PORTRAIT.length },
    };
    const second = await reopened.startEntryUpload(input);
    expect(second).toMatchObject({ ok: true });
    if (!second.ok) throw new Error(second.error);

    expect(await h.storage.put(first.uploadUrl, PHOTO, first.headers)).toEqual({
      ok: true,
    });
    const complete = {
      registrationId: asha.registrationId,
      ...REPLACEMENT_TEXT,
    };
    expect(
      await reopened.completeEntryUpload({ ...complete, fileId: first.fileId })
    ).toEqual({ ok: false, error: "file_not_found" });
    expect(
      await h.storage.put(second.uploadUrl, PORTRAIT, second.headers)
    ).toEqual({ ok: true });
    expect(
      await reopened.completeEntryUpload({ ...complete, fileId: second.fileId })
    ).toEqual({ ok: true, entryCode: code, status: "submitted" });

    h.clock.set(new Date(first.expiresAt.getTime() + 1000));
    await h.drain();
    expect(await reopened.getEntry({ code })).toMatchObject({
      ok: true,
      entry: { ...REPLACEMENT_TEXT, picture: { width: 400, height: 600 } },
    });
    expect(
      await h.storage.head({
        bucket: h.deps.files.bucket,
        key: `local/incoming/${first.fileId}`,
      })
    ).toBeNull();
  });

  it("lets the uploader change images after an interrupted upload just before closing", async () => {
    const h = await createHarness();
    const asha = await confirmedAdult(h);
    const code = await submittedImage(h, asha);
    await h.drain();
    const deadline = await closesAt(h, asha, code);
    h.clock.set(new Date(deadline.getTime() - 60_000));
    const app = h.as(asha.actor);
    const first = await app.startEntryUpload({
      registrationId: asha.registrationId,
      file: { name: "first.jpg", type: "image/jpeg", size: PHOTO.length },
    });
    if (!first.ok) throw new Error(first.error);
    const abandoned = {
      registrationId: asha.registrationId,
      fileId: first.fileId,
      ...ENTRY_TEXT,
    };
    expect(await app.completeEntryUpload(abandoned)).toEqual({
      ok: false,
      error: "upload_missing",
    });

    h.clock.advance({ seconds: 5 });
    const second = await app.startEntryUpload({
      registrationId: asha.registrationId,
      replacesFileId: first.fileId,
      file: { name: "second.jpg", type: "image/jpeg", size: PORTRAIT.length },
    });
    expect(second).toMatchObject({ ok: true });
    if (!second.ok) throw new Error(second.error);
    expect(await h.storage.put(first.uploadUrl, PHOTO, first.headers)).toEqual({
      ok: true,
    });
    expect(await app.completeEntryUpload(abandoned)).toEqual({
      ok: false,
      error: "file_not_found",
    });
    expect(
      await h.storage.put(second.uploadUrl, PORTRAIT, second.headers)
    ).toEqual({ ok: true });
    expect(
      await app.completeEntryUpload({ ...abandoned, fileId: second.fileId })
    ).toEqual({ ok: true, entryCode: code, status: "submitted" });
    h.clock.set(new Date(first.expiresAt.getTime() + 1000));
    await h.drain();
    expect(
      await h.storage.head({
        bucket: h.deps.files.bucket,
        key: `local/incoming/${first.fileId}`,
      })
    ).toBeNull();
    expect(await app.getEntry({ code })).toMatchObject({
      ok: true,
      entry: { picture: { width: 400, height: 600 } },
    });
  });

  it("restarts the uploader's pending replacement when its grant response was lost before close", async () => {
    const h = await createHarness();
    const asha = await confirmedAdult(h);
    const code = await submittedImage(h, asha);
    await h.drain();
    const deadline = await closesAt(h, asha, code);
    h.clock.set(new Date(deadline.getTime() - 30_000));
    const app = h.as(asha.actor);
    const registrationId = asha.registrationId;
    const first = await app.startEntryUpload({
      registrationId,
      file: { name: "first.jpg", type: "image/jpeg", size: PHOTO.length },
    });
    if (!first.ok) throw new Error(first.error);

    const file = {
      name: "replacement.jpg",
      type: "image/jpeg",
      size: PORTRAIT.length,
    };
    const lost = await app.startEntryUpload({
      registrationId,
      replacesFileId: first.fileId,
      file,
    });
    if (!lost.ok) throw new Error(lost.error);

    const recovered = await app.startEntryUpload({
      registrationId,
      restartPendingUpload: true,
      file,
    });
    if (!recovered.ok) throw new Error(recovered.error);
    await expect(
      app.completeEntryUpload({
        registrationId,
        fileId: lost.fileId,
        ...REPLACEMENT_TEXT,
      })
    ).resolves.toEqual({ ok: false, error: "file_not_found" });
    expect(
      await h.storage.put(recovered.uploadUrl, PORTRAIT, recovered.headers)
    ).toEqual({ ok: true });
    await expect(
      app.completeEntryUpload({
        registrationId,
        fileId: recovered.fileId,
        ...REPLACEMENT_TEXT,
      })
    ).resolves.toEqual({ ok: true, entryCode: code, status: "submitted" });
    await h.drain();
    expect(await app.getEntry({ code })).toMatchObject({
      ok: true,
      entry: { ...REPLACEMENT_TEXT, picture: { width: 400, height: 600 } },
    });
  });

  it("refuses a new entry, a replacement and a retry once submissions close", async () => {
    const h = await createHarness();
    const asha = await confirmedAdult(h);
    const ravi = await confirmedAdult(h, {
      competition: asha.competition,
      name: "Ravi Kumar",
    });
    const meera = await confirmedAdult(h, {
      competition: asha.competition,
      name: "Meera Iyer",
    });
    const code = await submittedImage(h, asha);
    await submittedImage(h, meera, { bytes: EICAR_TEST_BYTES });
    await h.drain();
    h.clock.set(await closesAt(h, asha, code));
    const file = { name: "late.jpg", type: "image/jpeg", size: PHOTO.length };

    for (const who of [asha, ravi, meera]) {
      expect(
        await h.as(who.actor).startEntryUpload({
          registrationId: who.registrationId,
          discipline: "drawing",
          file,
        })
      ).toEqual({ ok: false, error: "deadline_passed" });
    }
    const detail = await h.as(asha.actor).getEntry({ code });
    expect(detail).toMatchObject({ ok: true, entry: { uploadRule: null } });
  });

  it("refuses to complete an upload started before the deadline but finished after it", async () => {
    const h = await createHarness();
    const asha = await confirmedAdult(h);
    const code = await submittedImage(h, asha);
    await h.drain();
    const deadline = await closesAt(h, asha, code);
    h.clock.set(new Date(deadline.getTime() - 60_000));
    const started = await h.as(asha.actor).startEntryUpload({
      registrationId: asha.registrationId,
      file: { name: "late.jpg", type: "image/jpeg", size: PORTRAIT.length },
    });
    if (!started.ok) throw new Error(JSON.stringify(started));
    await h.storage.put(started.uploadUrl, PORTRAIT, started.headers);
    h.clock.set(deadline);

    const completed = await h.as(asha.actor).completeEntryUpload({
      registrationId: asha.registrationId,
      fileId: started.fileId,
      title: "Late",
      description: "Too late.",
    });

    expect(completed).toEqual({ ok: false, error: "deadline_passed" });
    expect(await fileStatuses(h)).toEqual(["live"]);
    await h.drain();
    const [file] = await h.db
      .select()
      .from(fileAsset)
      .where(eq(fileAsset.id, started.fileId));
    expect({
      uploadedAt: file?.uploadedAt,
      scans: h.scanner.scans,
      mediaJobs: h.media.processed.length,
    }).toEqual({ uploadedAt: null, scans: 1, mediaJobs: 1 });

    h.clock.set(new Date(started.expiresAt.getTime() + 1000));
    await h.drain();
    expect(
      await h.storage.head({ bucket: file!.bucket, key: file!.storageKey })
    ).toBeNull();
    expect(
      await h.db
        .select()
        .from(fileAsset)
        .where(eq(fileAsset.id, started.fileId))
    ).toEqual([]);
    expect(await picture(h, asha, code)).toMatchObject({ width: 1600 });
  });

  it("counts an upload completed before the deadline whose checks finish after it", async () => {
    const h = await createHarness();
    const asha = await confirmedAdult(h);
    const ravi = await confirmedAdult(h, {
      competition: asha.competition,
      name: "Ravi Kumar",
    });
    const code = await submittedImage(h, asha);
    await h.drain();
    const deadline = await closesAt(h, asha, code);
    h.clock.set(new Date(deadline.getTime() - 60_000));
    await submittedImage(h, ravi);
    // The worker gets to it an hour after the deadline.
    h.clock.set(new Date(deadline.getTime() + 60 * 60_000));

    await h.drain();

    const [list] = await h.as(ravi.actor).listMyEntries();
    expect(list).toMatchObject({ status: "submitted" });
  });

  it("refuses an upload before submissions open", async () => {
    const h = await createHarness();
    const asha = await confirmedAdult(h);
    // Registration, and with it submissions, opened 20 days ago.
    h.clock.set(new Date(h.clock.now().getTime() - 21 * 24 * 60 * 60_000));

    const started = await h.as(asha.actor).startEntryUpload({
      registrationId: asha.registrationId,
      discipline: "drawing",
      file: { name: "early.jpg", type: "image/jpeg", size: PHOTO.length },
    });

    expect(started).toEqual({ ok: false, error: "submission_not_open" });
    expect(await h.db.select().from(fileAsset)).toEqual([]);
  });
});
