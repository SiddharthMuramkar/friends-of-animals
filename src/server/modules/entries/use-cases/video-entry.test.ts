import { and, asc, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  entry,
  entryFile,
  entryTransition,
  fileAsset,
  fileDerivative,
  fileProcessing,
  outbox,
} from "@/server/db/schema";
import { openToIndividuals } from "@/server/modules/participants/testing";
import { signInStaff } from "@/server/modules/payments/testing";
import { createHarness, type Harness } from "@/test/harness";
import { readMediaFixture } from "@/test/media-fixtures";

import {
  CLIP,
  confirmedAdult,
  confirmedChild,
  ENTRY_TEXT,
  putEntryImage,
  submitImage,
  submittedImage,
  VIDEO_UPLOAD,
  type Participant,
} from "../testing";

// #86, unit 86a: a videography entry. Phone formats within the size and
// length limits are taken, checked in the browser (the same rule), when
// the upload starts and completes, and by worker-media's ffprobe (the
// media processor, faked at its port, runs the same length rule). After a
// clean scan the video is transcoded and gets a poster; the entry is then
// submitted and plays from the copy, never the original.

const MB = 1024 * 1024;

async function videographer(h: Harness): Promise<Participant> {
  return confirmedAdult(h, { disciplines: ["videography"] });
}

async function onlyEntry(h: Harness) {
  const [row] = await h.db.select().from(entry);
  return row!;
}

async function files(h: Harness) {
  return h.db
    .select({
      kind: entryFile.kind,
      status: entryFile.status,
      assetId: entryFile.fileAssetId,
    })
    .from(entryFile)
    .orderBy(asc(entryFile.attemptNumber));
}

async function entryOf(h: Harness, who: Participant, code: string) {
  const result = await h.as(who.actor).getEntry({ code });
  if (!result.ok) throw new Error(JSON.stringify(result));
  return result.entry;
}

describe("a video entry", () => {
  it("is submitted once its video is transcoded, and plays from the copy and its poster", async () => {
    const h = await createHarness();
    const asha = await videographer(h);

    const code = await submittedImage(h, asha, VIDEO_UPLOAD);
    expect(await onlyEntry(h)).toMatchObject({
      code,
      status: "processing",
      discipline: "videography",
    });
    const [upload] = await h.db.select().from(fileAsset);
    expect(upload).toMatchObject({
      purpose: "entry_video",
      contentType: "video/quicktime",
      sizeBytes: CLIP.length,
    });

    await h.drain();

    expect(await onlyEntry(h)).toMatchObject({
      status: "submitted",
      submittedAt: h.clock.now(),
    });
    expect(await files(h)).toEqual([
      { kind: "video", status: "live", assetId: upload!.id },
    ]);
    // worker-media got the clean original and the purpose's length limit.
    expect(h.media.videos).toEqual([
      { sizeBytes: CLIP.length, maxDurationMs: 180_000 },
    ]);
    expect(h.media.processed).toEqual([]);
    expect(
      h.email.sent
        .filter((mail) => mail.to === asha.email)
        .map((m) => m.subject)
    ).toContain(`Entry ${code} received for Seed competition 1`);

    const shown = await entryOf(h, asha, code);
    expect(shown).toMatchObject({
      format: "video",
      picture: null,
      essay: null,
      latestUpload: null,
      latestProblem: null,
      video: { width: 1920, height: 1080, durationMs: 40_000 },
      uploadRule: { kind: "video", maxDurationMs: 180_000 },
    });
    const copy = await h.storage.get(shown.video!.url);
    expect(copy).toMatchObject({ ok: true, contentType: "video/mp4" });
    const poster = await h.storage.get(shown.video!.posterUrl!);
    expect(poster).toMatchObject({ ok: true, contentType: "image/jpeg" });
    // Both are derivatives; the original's key is never signed.
    const derived = await h.db
      .select({ kind: fileDerivative.kind, key: fileDerivative.storageKey })
      .from(fileDerivative)
      .orderBy(asc(fileDerivative.kind));
    expect(derived).toEqual([
      { kind: "video_mp4", key: `local/derived/${upload!.id}/video_mp4.mp4` },
      {
        kind: "video_poster",
        key: `local/derived/${upload!.id}/video_poster.jpg`,
      },
    ]);
    expect(shown.video!.url).not.toContain(upload!.storageKey);
  });

  it("takes a video for a child from their guardian, and shows it to them", async () => {
    const h = await createHarness();
    const competition = await openToIndividuals(h, {
      fee: 0n,
      disciplines: ["videography"],
    });
    const child = await confirmedChild(h, { competition });

    const code = await submittedImage(h, child, VIDEO_UPLOAD);
    await h.drain();

    const shown = await entryOf(h, child, code);
    expect(shown).toMatchObject({ status: "submitted", whose: "child" });
    expect(shown.video).not.toBeNull();
  });

  it("refuses a video over the size limit when the upload starts, and makes nothing", async () => {
    const h = await createHarness();
    const asha = await videographer(h);

    const started = await h.as(asha.actor).startEntryUpload({
      registrationId: asha.registrationId,
      discipline: "videography",
      file: { name: "big.mp4", type: "video/mp4", size: 200 * MB + 1 },
    });

    expect(started).toEqual({ ok: false, error: "too_large" });
    expect(await h.db.select().from(fileAsset)).toEqual([]);
  });

  it("refuses a video whose stored size isn't the one declared", async () => {
    const h = await createHarness();
    const asha = await videographer(h);
    const started = await h.as(asha.actor).startEntryUpload({
      registrationId: asha.registrationId,
      discipline: "videography",
      file: { name: "clip.mov", type: "video/quicktime", size: 1000 },
    });
    if (!started.ok) throw new Error(JSON.stringify(started));
    const [file] = await h.db.select().from(fileAsset);
    h.storage.plant({
      bucket: file!.bucket,
      key: `local/incoming/${started.fileId}`,
      bytes: CLIP,
      contentType: "video/quicktime",
    });

    const completed = await h.as(asha.actor).completeEntryUpload({
      registrationId: asha.registrationId,
      discipline: "videography",
      fileId: started.fileId,
      ...ENTRY_TEXT,
    });

    expect(completed).toEqual({ ok: false, error: "upload_rejected" });
    expect(await h.db.select().from(entry)).toEqual([]);
  });

  it("refuses a clip the browser measured as too long, and lets one it couldn't measure through", async () => {
    const h = await createHarness();
    const asha = await videographer(h);
    const start = (durationMs: number | null) =>
      h.as(asha.actor).startEntryUpload({
        registrationId: asha.registrationId,
        discipline: "videography",
        file: {
          name: "clip.mov",
          type: "video/quicktime",
          size: CLIP.length,
          durationMs,
        },
      });

    expect(await start(181_001)).toEqual({ ok: false, error: "too_long" });
    expect(await h.db.select().from(fileAsset)).toEqual([]);
    expect(await start(null)).toMatchObject({ ok: true });
  });

  it("fails the entry, and says why, when worker-media measures the clip as too long", async () => {
    const h = await createHarness();
    const asha = await videographer(h);
    // The browser couldn't read the length (HEVC in Chrome).
    const code = await submittedImage(h, asha, {
      ...VIDEO_UPLOAD,
      durationMs: null,
    });
    h.media.nextVideo({ durationMs: 181_001 });

    await h.drain();

    expect(await onlyEntry(h)).toMatchObject({
      status: "failed",
      submittedAt: null,
    });
    expect(await files(h)).toMatchObject([{ status: "failed" }]);
    expect(await h.db.select().from(fileDerivative)).toEqual([]);
    const [job] = await h.db.select().from(fileProcessing);
    expect(job).toMatchObject({
      status: "failed",
      errorCode: "video_too_long",
    });
    expect(await entryOf(h, asha, code)).toMatchObject({
      status: "failed",
      latestUpload: "failed",
      latestProblem: "video_too_long",
      video: null,
    });
    const notice = h.email.sent.find(
      (mail) => mail.to === asha.email && mail.subject.includes(code)
    );
    expect(notice?.subject).toBe(`We couldn't open the file for ${code}`);
    expect(notice?.text).toContain("try again before submissions close");
    expect(notice?.text).toContain("for a video, longer than the time limit");
    expect(notice?.text).not.toMatch(/picture|image/);
  });

  it("fails the entry when the clip can't be decoded, and a retry submits it", async () => {
    const h = await createHarness();
    const asha = await videographer(h);
    const code = await submittedImage(h, asha, VIDEO_UPLOAD);
    h.media.failNext(1, "media_decode_failed");
    await h.drain();
    expect(await entryOf(h, asha, code)).toMatchObject({
      status: "failed",
      latestProblem: "media_decode_failed",
    });

    const retried = await submitImage(h, asha, VIDEO_UPLOAD);
    expect(retried).toEqual({
      ok: true,
      entryCode: code,
      status: "processing",
    });
    await h.drain();

    expect(await onlyEntry(h)).toMatchObject({ status: "submitted" });
    const moves = await h.db
      .select({
        from: entryTransition.fromStatus,
        to: entryTransition.toStatus,
      })
      .from(entryTransition)
      .orderBy(asc(entryTransition.sequence));
    expect(moves).toEqual([
      { from: null, to: "processing" },
      { from: "processing", to: "failed" },
      { from: "failed", to: "processing" },
      { from: "processing", to: "submitted" },
    ]);
  });

  it("keeps the entry processing through a transient processor error, and the retry finishes it", async () => {
    const h = await createHarness();
    const asha = await videographer(h);
    await submittedImage(h, asha, VIDEO_UPLOAD);
    const media = h.deps.media;
    let calls = 0;
    h.deps.media = {
      processImage: (input) => media.processImage(input),
      processVideo: (input) => {
        calls += 1;
        return calls === 1
          ? Promise.reject(new Error("R2 timed out"))
          : media.processVideo(input);
      },
    };

    await h.drain();
    expect(await onlyEntry(h)).toMatchObject({ status: "processing" });

    h.clock.advance({ seconds: 30 });
    await h.drain();
    expect(await onlyEntry(h)).toMatchObject({ status: "submitted" });
    expect(calls).toBe(2);
  });

  it("claims a transcode with a lease longer than ffmpeg's deadline", async () => {
    const h = await createHarness();
    const asha = await videographer(h);
    await submittedImage(h, asha, VIDEO_UPLOAD);
    const media = h.deps.media;
    const leases: (Date | null)[] = [];
    h.deps.media = {
      processImage: (input) => media.processImage(input),
      async processVideo(input) {
        const [row] = await h.db
          .select({ lockedUntil: outbox.lockedUntil })
          .from(outbox)
          .where(eq(outbox.handler, "files.process_video"));
        leases.push(row!.lockedUntil);
        return media.processVideo(input);
      },
    };

    await h.drain();

    expect(leases).toEqual([
      new Date(h.clock.now().getTime() + 20 * 60 * 1000),
    ]);
  });

  it("keeps a live video submitted until its replacement is live", async () => {
    const h = await createHarness();
    const asha = await videographer(h);
    const code = await submittedImage(h, asha, VIDEO_UPLOAD);
    await h.drain();
    const first = await entryOf(h, asha, code);

    const replaced = await submitImage(h, asha, {
      ...VIDEO_UPLOAD,
      text: { title: "A second take", description: ENTRY_TEXT.description },
    });
    expect(replaced).toEqual({
      ok: true,
      entryCode: code,
      status: "submitted",
    });
    const pending = await entryOf(h, asha, code);
    expect(pending).toMatchObject({
      status: "submitted",
      title: ENTRY_TEXT.title,
      latestUpload: "pending",
    });
    expect(pending.video).not.toBeNull();
    expect((await files(h)).map((file) => file.status)).toEqual([
      "live",
      "pending",
    ]);

    await h.drain();

    expect((await files(h)).map((file) => file.status)).toEqual([
      "superseded",
      "live",
    ]);
    const shown = await entryOf(h, asha, code);
    expect(shown).toMatchObject({ title: "A second take", latestUpload: null });
    expect(shown.video!.url).not.toBe(first.video!.url);
  });

  it("takes MOV bytes declared as MP4, and rejects a picture declared as a video", async () => {
    const h = await createHarness();
    const asha = await videographer(h);
    await submittedImage(h, asha, { ...VIDEO_UPLOAD, type: "video/mp4" });
    await h.drain();
    expect(await onlyEntry(h)).toMatchObject({ status: "submitted" });

    const other = await createHarness();
    const ravi = await videographer(other);
    await submittedImage(other, ravi, {
      ...VIDEO_UPLOAD,
      bytes: readMediaFixture("gpsJpeg"),
      type: "video/mp4",
    });
    await other.drain();
    const [failed] = await other.db.select().from(entry);
    expect(failed).toMatchObject({ status: "failed" });
    const [asset] = await other.db.select().from(fileAsset);
    expect(asset).toMatchObject({
      status: "rejected",
      scanResult: "type_mismatch",
    });
    expect(other.media.videos).toEqual([]);
  });

  it("takes a WebM clip as well", async () => {
    const h = await createHarness();
    const asha = await videographer(h);
    await submittedImage(h, asha, {
      ...VIDEO_UPLOAD,
      bytes: readMediaFixture("clipWebm"),
      name: "clip.webm",
      type: "video/webm",
    });
    await h.drain();
    expect(await onlyEntry(h)).toMatchObject({ status: "submitted" });
  });

  it("refuses a picture for a video entry when the upload starts", async () => {
    const h = await createHarness();
    const asha = await videographer(h);
    await expect(
      putEntryImage(h, asha, { discipline: "videography" })
    ).rejects.toThrow(/wrong_type/);
  });
});

describe("who may submit and see a video entry", () => {
  it("refuses another participant, a member, a competition manager and a visitor", async () => {
    const h = await createHarness();
    const asha = await videographer(h);
    const code = await submittedImage(h, asha, VIDEO_UPLOAD);
    await h.drain();
    const ravi = await confirmedAdult(h, {
      competition: asha.competition,
      name: "Ravi Kumar",
    });
    const member = await h.signIn(await h.seed.member());
    const manager = await signInStaff(h, "competition_manager");

    for (const actor of [ravi.actor, member, manager.actor, h.visitor()]) {
      await expect(
        h.as(actor).startEntryUpload({
          registrationId: asha.registrationId,
          discipline: "videography",
          file: { name: "clip.mov", type: "video/quicktime", size: 10 },
        })
      ).rejects.toMatchObject({ code: "forbidden" });
      await expect(h.as(actor).getEntry({ code })).rejects.toMatchObject({
        code: "forbidden",
      });
    }
  });

  it("lets a competition manager list it only once it is submitted", async () => {
    const h = await createHarness();
    const asha = await videographer(h);
    const code = await submittedImage(h, asha, VIDEO_UPLOAD);
    const manager = await h.seed.member({ email: "manager@example.test" });
    await h.seed.grant(manager, {
      role: "competition_manager",
      scope: { type: "competition", id: asha.competition.id },
    });
    const staff = h.as(await h.signIn(manager));
    const listed = async () =>
      (
        (await staff.listCompetitionEntries({
          competitionId: asha.competition.id,
        })) as { code: string }[]
      ).map((each) => each.code);

    expect(await listed()).toEqual([]);
    await h.drain();
    expect(await listed()).toEqual([code]);
    const [file] = await h.db
      .select({ status: entryFile.status })
      .from(entryFile)
      .where(and(eq(entryFile.kind, "video"), eq(entryFile.status, "live")));
    expect(file).toBeDefined();
  });
});
