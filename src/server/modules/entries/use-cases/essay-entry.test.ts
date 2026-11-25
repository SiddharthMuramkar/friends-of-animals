import { asc, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  entry,
  entryFile,
  entryTransition,
  fileAsset,
  outbox,
} from "@/server/db/schema";
import { openToIndividuals } from "@/server/modules/participants/testing";
import { signInStaff } from "@/server/modules/payments/testing";
import { sanitizeEssayBody } from "@/server/rich-text/essay";
import { EICAR_TEST_BYTES } from "@/test/eicar";
import { createHarness, type Harness } from "@/test/harness";
import { readMediaFixture } from "@/test/media-fixtures";

import {
  confirmedAdult,
  confirmedChild,
  ENTRY_TEXT,
  ESSAY_PDF_UPLOAD,
  essayOf,
  submitImage,
  submittedImage,
  typedEssay,
  type Participant,
} from "../testing";

// Invisible characters, by name, so none sits in this file.
const ZWSP = String.fromCodePoint(0x200b);
const ZWJ = String.fromCodePoint(0x200d);
const POP = String.fromCodePoint(0x202c);
const RLO = String.fromCodePoint(0x202e);

// #86, unit 86b: an essay entry, typed into the form or uploaded as a PDF.
// Typed text has nothing to scan, so it is live and the entry submitted at
// once (the owner's ruling, 2026-11-19); it is stored through the
// rich-text sanitiser's `essay` profile as paragraphs of plain text. A PDF
// goes through the scan like any file, and is live once it passes.
// Replacing an essay can switch between text and a document.

async function essayist(h: Harness): Promise<Participant> {
  return confirmedAdult(h, { disciplines: ["essay"] });
}

async function onlyEntry(h: Harness) {
  const [row] = await h.db.select().from(entry);
  return row!;
}

async function files(h: Harness) {
  return h.db
    .select({ kind: entryFile.kind, status: entryFile.status })
    .from(entryFile)
    .orderBy(asc(entryFile.attemptNumber));
}

async function moves(h: Harness) {
  return h.db
    .select({
      from: entryTransition.fromStatus,
      to: entryTransition.toStatus,
      trigger: entryTransition.trigger,
    })
    .from(entryTransition)
    .orderBy(asc(entryTransition.sequence));
}

async function entryOf(h: Harness, who: Participant, code: string) {
  const result = await h.as(who.actor).getEntry({ code });
  if (!result.ok) throw new Error(JSON.stringify(result));
  return result.entry;
}

function submitText(h: Harness, who: Participant, essay: string) {
  return h.as(who.actor).submitEssayText({
    registrationId: who.registrationId,
    discipline: "essay",
    ...ENTRY_TEXT,
    essay,
  });
}

describe("a typed essay", () => {
  it("is submitted at once, with its Entry ID and receipt, and nothing to scan", async () => {
    const h = await createHarness();
    const asha = await essayist(h);

    const result = await submitText(
      h,
      asha,
      "Our street has six dogs.\nThey drink from one bowl.\n\nWe fill it every morning."
    );

    if (!result.ok) throw new Error(JSON.stringify(result));
    expect(result).toEqual({
      ok: true,
      entryCode: expect.stringMatching(/^CMPAA27-E-[0-9A-Z]{6}$/),
      status: "submitted",
    });
    expect(await onlyEntry(h)).toMatchObject({
      code: result.entryCode,
      discipline: "essay",
      status: "submitted",
      submittedAt: h.clock.now(),
    });
    expect(await moves(h)).toEqual([
      { from: null, to: "submitted", trigger: "essay_typed" },
    ]);
    const [file] = await h.db.select().from(entryFile);
    expect(file).toMatchObject({
      kind: "text",
      status: "live",
      fileAssetId: null,
      wordCount: 15,
      becameLiveAt: h.clock.now(),
      essayBody: {
        paragraphs: [
          ["Our street has six dogs.", "They drink from one bowl."],
          ["We fill it every morning."],
        ],
      },
    });
    expect(await h.db.select().from(fileAsset)).toEqual([]);

    await h.drain();
    expect(h.scanner.scans).toBe(0);
    expect(
      h.email.sent
        .filter((mail) => mail.to === asha.email)
        .map((m) => m.subject)
    ).toContain(`Entry ${result.entryCode} received for Seed competition 1`);
    expect(await entryOf(h, asha, result.entryCode)).toMatchObject({
      format: "essay",
      status: "submitted",
      essay: {
        kind: "text",
        wordCount: 15,
        body: file!.essayBody,
      },
      latestUpload: null,
      uploadRule: { kind: "document" },
    });
  });

  it("keeps markup as the text it is, and drops control and direction-override characters", async () => {
    const h = await createHarness();
    const asha = await essayist(h);
    const typed =
      "<script>alert(1)</script> <img src=x onerror=alert(1)> javascript:alert(1)\n\n" +
      "a<b and <Bruno> " +
      RLO +
      "evil" +
      POP +
      "\u0007 " +
      ZWJ +
      "kept";

    const code = await typedEssay(h, asha, typed);

    const shown = await entryOf(h, asha, code);
    expect(shown.essay).toMatchObject({
      kind: "text",
      body: {
        paragraphs: [
          [
            "<script>alert(1)</script> <img src=x onerror=alert(1)> javascript:alert(1)",
          ],
          ["a<b and <Bruno> evil " + ZWJ + "kept"],
        ],
      },
    });
    const [file] = await h.db.select().from(entryFile);
    // What is stored is what the profile lets through.
    expect(file!.essayBody).toEqual(sanitizeEssayBody(file!.essayBody));
  });

  it("refuses an essay over the word limit, and an empty one, and creates nothing", async () => {
    const h = await createHarness();
    const asha = await essayist(h);

    expect(await submitText(h, asha, essayOf(1501))).toEqual({
      ok: false,
      error: "too_many_words",
    });
    expect(await submitText(h, asha, "  \n\n\t " + ZWSP + " ")).toEqual({
      ok: false,
      error: "empty",
    });
    expect(await submitText(h, asha, "x".repeat(20_001))).toEqual({
      ok: false,
      error: "too_long",
    });
    expect(await h.db.select().from(entry)).toEqual([]);

    expect(await submitText(h, asha, essayOf(1500))).toMatchObject({
      ok: true,
    });
  });

  it("refuses typed text for a discipline that isn't an essay", async () => {
    const h = await createHarness();
    const asha = await confirmedAdult(h, {
      disciplines: ["drawing", "essay"],
    });
    expect(
      await h.as(asha.actor).submitEssayText({
        registrationId: asha.registrationId,
        discipline: "drawing",
        ...ENTRY_TEXT,
        essay: "Some words.",
      })
    ).toEqual({ ok: false, error: "discipline_not_offered" });
    expect(
      await h.as(asha.actor).submitEssayText({
        registrationId: asha.registrationId,
        ...ENTRY_TEXT,
        essay: "Some words.",
      })
    ).toEqual({ ok: false, error: "discipline_required" });
  });

  it("refuses typed text at the deadline and before submissions open", async () => {
    const h = await createHarness();
    const asha = await essayist(h);
    const code = await typedEssay(h, asha, "On time.");
    const result = await h.as(asha.actor).getEntry({ code });
    if (!result.ok || !result.entry.closesAt) throw new Error("No deadline");
    h.clock.set(result.entry.closesAt);
    expect(await submitText(h, asha, "Too late.")).toEqual({
      ok: false,
      error: "deadline_passed",
    });
    expect(
      await h.as(asha.actor).startEntryUpload({
        registrationId: asha.registrationId,
        discipline: "essay",
        file: { name: "late.pdf", type: "application/pdf", size: 100 },
      })
    ).toEqual({ ok: false, error: "deadline_passed" });

    const early = await createHarness();
    const ravi = await essayist(early);
    // Registration, and with it submissions, opened 20 days ago.
    early.clock.set(
      new Date(early.clock.now().getTime() - 21 * 24 * 60 * 60_000)
    );
    expect(await submitText(early, ravi, "Too early.")).toEqual({
      ok: false,
      error: "submission_not_open",
    });
    expect(await early.db.select().from(entry)).toEqual([]);
  });
});

describe("an essay as a PDF", () => {
  it("is processing until its scan passes, then submitted and readable", async () => {
    const h = await createHarness();
    const asha = await essayist(h);

    const code = await submittedImage(h, asha, ESSAY_PDF_UPLOAD);
    expect(await onlyEntry(h)).toMatchObject({ status: "processing" });
    const [upload] = await h.db.select().from(fileAsset);
    expect(upload).toMatchObject({
      purpose: "entry_document",
      contentType: "application/pdf",
    });

    await h.drain();

    expect(await onlyEntry(h)).toMatchObject({ status: "submitted" });
    expect(await files(h)).toEqual([{ kind: "document", status: "live" }]);
    expect(h.media.processed).toEqual([]);
    expect(h.media.videos).toEqual([]);
    const shown = await entryOf(h, asha, code);
    expect(shown.essay).toMatchObject({ kind: "document" });
    if (shown.essay?.kind !== "document") throw new Error("no document");
    expect(await h.storage.get(shown.essay.url)).toMatchObject({
      ok: true,
      contentType: "application/pdf",
    });
  });

  it("rejects an infected PDF and offers a retry", async () => {
    const h = await createHarness();
    const asha = await essayist(h);
    const code = await submittedImage(h, asha, {
      ...ESSAY_PDF_UPLOAD,
      bytes: EICAR_TEST_BYTES,
    });
    await h.drain();

    expect(await entryOf(h, asha, code)).toMatchObject({
      status: "rejected",
      latestUpload: "rejected",
      essay: null,
      uploadRule: { kind: "document" },
    });
  });

  it("refuses another type for an essay, and rejects a picture declared as a PDF", async () => {
    const h = await createHarness();
    const asha = await essayist(h);
    const started = await h.as(asha.actor).startEntryUpload({
      registrationId: asha.registrationId,
      discipline: "essay",
      file: { name: "essay.png", type: "image/png", size: 100 },
    });
    expect(started).toEqual({ ok: false, error: "wrong_type" });

    await submittedImage(h, asha, {
      ...ESSAY_PDF_UPLOAD,
      bytes: readMediaFixture("gpsJpeg"),
    });
    await h.drain();
    expect(await onlyEntry(h)).toMatchObject({ status: "failed" });
    const [asset] = await h.db.select().from(fileAsset);
    expect(asset).toMatchObject({ status: "rejected" });
  });
});

describe("replacing an essay", () => {
  it("keeps typed text live until a PDF that replaces it passes its scan", async () => {
    const h = await createHarness();
    const asha = await essayist(h);
    const code = await typedEssay(h, asha);

    const replaced = await submitImage(h, asha, ESSAY_PDF_UPLOAD);
    expect(replaced).toEqual({
      ok: true,
      entryCode: code,
      status: "submitted",
    });
    expect(await files(h)).toEqual([
      { kind: "text", status: "live" },
      { kind: "document", status: "pending" },
    ]);
    expect((await entryOf(h, asha, code)).essay).toMatchObject({
      kind: "text",
    });

    await h.drain();

    expect(await files(h)).toEqual([
      { kind: "text", status: "superseded" },
      { kind: "document", status: "live" },
    ]);
    expect(await onlyEntry(h)).toMatchObject({ status: "submitted" });
    expect((await entryOf(h, asha, code)).essay).toMatchObject({
      kind: "document",
    });
  });

  it("puts typed text live at once over a PDF, dropping the PDF and any upload in flight", async () => {
    const h = await createHarness();
    const asha = await essayist(h);
    const code = await submittedImage(h, asha, ESSAY_PDF_UPLOAD);
    await h.drain();
    // A second PDF still being checked.
    await submitImage(h, asha, ESSAY_PDF_UPLOAD);
    const receipts = h.email.sent.length;

    const typed = await submitText(h, asha, "A fresh start.");

    expect(typed).toEqual({ ok: true, entryCode: code, status: "submitted" });
    expect(await files(h)).toEqual([
      { kind: "document", status: "superseded" },
      { kind: "document", status: "superseded" },
      { kind: "text", status: "live" },
    ]);
    expect((await entryOf(h, asha, code)).essay).toMatchObject({
      kind: "text",
      body: { paragraphs: [["A fresh start."]] },
    });
    // The dropped upload's late verdict changes nothing.
    await h.drain();
    expect(await files(h)).toMatchObject([
      { status: "superseded" },
      { status: "superseded" },
      { kind: "text", status: "live" },
    ]);
    // A replacement sends no receipt.
    expect(h.email.sent).toHaveLength(receipts);
  });

  it("replaces typed text with typed text in one step, and moves the words onto the entry", async () => {
    const h = await createHarness();
    const asha = await essayist(h);
    const code = await typedEssay(h, asha, "First draft.");

    const again = await h.as(asha.actor).submitEssayText({
      registrationId: asha.registrationId,
      title: "Second title",
      description: ENTRY_TEXT.description,
      essay: "Second draft, longer.",
    });

    expect(again).toEqual({ ok: true, entryCode: code, status: "submitted" });
    expect(await files(h)).toEqual([
      { kind: "text", status: "superseded" },
      { kind: "text", status: "live" },
    ]);
    expect(await entryOf(h, asha, code)).toMatchObject({
      title: "Second title",
      essay: { kind: "text", wordCount: 3 },
    });
    expect(await moves(h)).toEqual([
      { from: null, to: "submitted", trigger: "essay_typed" },
    ]);
  });

  it("retries a rejected entry with typed text: processing, then submitted, in one step", async () => {
    const h = await createHarness();
    const asha = await essayist(h);
    const code = await submittedImage(h, asha, {
      ...ESSAY_PDF_UPLOAD,
      bytes: EICAR_TEST_BYTES,
    });
    await h.drain();
    expect(await onlyEntry(h)).toMatchObject({ status: "rejected" });
    await h.db.delete(outbox);

    const typed = await submitText(h, asha, "Typed instead.");

    expect(typed).toEqual({ ok: true, entryCode: code, status: "submitted" });
    expect(await moves(h)).toEqual([
      { from: null, to: "processing", trigger: "upload_completed" },
      { from: "processing", to: "rejected", trigger: "file_infected" },
      { from: "rejected", to: "processing", trigger: "upload_retried" },
      { from: "processing", to: "submitted", trigger: "essay_typed" },
    ]);
    expect(await onlyEntry(h)).toMatchObject({
      status: "submitted",
      submittedAt: h.clock.now(),
    });
    const events = await h.db
      .select({ type: outbox.eventType })
      .from(outbox)
      .where(eq(outbox.handler, "notifications.dispatch"));
    expect(events).toEqual([{ type: "entry.submitted" }]);
  });

  it("submits a processing entry with typed text, dropping the first PDF still being scanned", async () => {
    const h = await createHarness();
    const asha = await essayist(h);
    const code = await submittedImage(h, asha, ESSAY_PDF_UPLOAD);

    await submitText(h, asha, "Typed while it scanned.");
    await h.drain();

    expect(await files(h)).toEqual([
      { kind: "document", status: "superseded" },
      { kind: "text", status: "live" },
    ]);
    expect(await moves(h)).toEqual([
      { from: null, to: "processing", trigger: "upload_completed" },
      { from: "processing", to: "submitted", trigger: "essay_typed" },
    ]);
    expect(await entryOf(h, asha, code)).toMatchObject({ status: "submitted" });
  });
});

describe("who may submit and see an essay", () => {
  it("lets a verified guardian type their child's essay and read it", async () => {
    const h = await createHarness();
    const competition = await openToIndividuals(h, {
      fee: 0n,
      disciplines: ["essay"],
    });
    const child = await confirmedChild(h, { competition });

    const code = await typedEssay(h, child, "Isha's essay.");

    expect(await entryOf(h, child, code)).toMatchObject({
      whose: "child",
      essay: { kind: "text" },
    });
  });

  it("refuses another participant, a member, a competition manager and a visitor", async () => {
    const h = await createHarness();
    const asha = await essayist(h);
    const code = await typedEssay(h, asha);
    const ravi = await confirmedAdult(h, {
      competition: asha.competition,
      name: "Ravi Kumar",
    });
    const member = await h.signIn(await h.seed.member());
    const manager = await signInStaff(h, "competition_manager");

    for (const actor of [ravi.actor, member, manager.actor, h.visitor()]) {
      await expect(
        h.as(actor).submitEssayText({
          registrationId: asha.registrationId,
          discipline: "essay",
          ...ENTRY_TEXT,
          essay: "Not theirs.",
        })
      ).rejects.toMatchObject({ code: "forbidden" });
      await expect(h.as(actor).getEntry({ code })).rejects.toMatchObject({
        code: "forbidden",
      });
    }
    expect(await files(h)).toEqual([{ kind: "text", status: "live" }]);
  });

  it("lists a submitted essay for its competition manager", async () => {
    const h = await createHarness();
    const asha = await essayist(h);
    const code = await typedEssay(h, asha);
    const manager = await h.seed.member({ email: "manager@example.test" });
    await h.seed.grant(manager, {
      role: "competition_manager",
      scope: { type: "competition", id: asha.competition.id },
    });

    const listed = await h
      .as(await h.signIn(manager))
      .listCompetitionEntries({ competitionId: asha.competition.id });

    expect(listed).toMatchObject([{ code }]);
  });
});
