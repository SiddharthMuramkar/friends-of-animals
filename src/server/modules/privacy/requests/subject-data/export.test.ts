// #115b: an access request produces a complete export of the person's
// data, as a ZIP behind a signed link that only the requester can use and
// that expires.

import { eq, inArray, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { outbox, participantProfile } from "@/server/db/schema";
import { readMediaFixture } from "@/test/media-fixtures";
import { createHarness, type Harness } from "@/test/harness";

import { DATA_INVENTORY } from "../../inventory";
import { requestRows, signedInOfficer } from "../testing";
import { readZip } from "./read-zip";
import { TABLES_BY_NAME, columnNamed } from "./sections";
import {
  ASHA,
  paidCompetition,
  participantWithEntry,
  RAVI,
  type Participant,
} from "./testing";

const PHOTO = readMediaFixture("gpsJpeg");

async function exportedBy(h: Harness, who: Participant) {
  const filed = await h
    .as(who.actor)
    .submitPrivacyRequest({ type: "access", subject: { kind: "self" } });
  if (!filed.ok) throw new Error(JSON.stringify(filed));
  const officer = await signedInOfficer(h);
  await h.as(officer.actor).startPrivacyRequest({ id: filed.requestId });
  expect(
    await h.as(officer.actor).buildSubjectExport({ id: filed.requestId })
  ).toEqual({ ok: true });
  await h.drain();
  return { ...filed, officer };
}

async function download(h: Harness, who: Participant, requestId: string) {
  const link = await h.as(who.actor).getPrivacyExportLink({ id: requestId });
  if (!link.ok) throw new Error(JSON.stringify(link));
  const got = await h.storage.get(link.url);
  if (!got.ok) throw new Error(got.error);
  return { got, zip: readZip(got.bytes) };
}

describe("buildSubjectExport", () => {
  it("packs every section of the person's data, decrypted, with their uploads, and nobody else's", async () => {
    const h = await createHarness();
    const competition = await paidCompetition(h);
    const asha = await participantWithEntry(h, competition, ASHA);
    const ravi = await participantWithEntry(h, competition, RAVI);
    const filed = await exportedBy(h, asha);

    expect(await requestRows(h)).toEqual([
      expect.objectContaining({
        status: "completed",
        exportReadyAt: h.clock.now(),
      }),
    ]);
    const { got, zip } = await download(h, asha, filed.requestId);
    expect(got.contentType).toBe("application/zip");
    expect(got.contentDisposition).toBe(
      `attachment; filename="foa-data-${filed.reference}.zip"`
    );
    expect(zip.names.slice(0, 2)).toEqual(["README.txt", "data.json"]);
    const data = JSON.parse(zip.text("data.json"));

    expect(data.subject).toEqual({ kind: "user", id: asha.userId });
    expect(data.sections.user).toEqual([
      expect.objectContaining({ id: asha.userId, email: ASHA.email }),
    ]);
    expect(data.sections.participant_profile).toEqual([
      expect.objectContaining({
        id: asha.profileId,
        full_name: ASHA.name,
        dob: ASHA.dateOfBirth,
        phone: "+919000000777",
      }),
    ]);
    expect(data.sections.participant_profile[0]).not.toHaveProperty(
      "identity_hash"
    );
    expect(data.sections.session[0]).not.toHaveProperty("token");
    for (const name of [
      "registration",
      "entry",
      "entry_file",
      "payment_batch",
      "payment_batch_item",
      "consent_event",
      "inbox_item",
      "message_delivery",
      "file_asset",
      "privacy_request",
      "audit_log",
    ]) {
      expect(data.sections[name]?.length, name).toBeGreaterThan(0);
    }
    // The photo they sent, byte for byte.
    expect(data.files).toHaveLength(1);
    const photo = zip.entries.find(
      (entry) => entry.name === data.files[0].path
    );
    expect(photo?.bytes).toEqual(PHOTO);

    // Nothing of the other participant, anywhere in the archive.
    const everything = zip.allText();
    for (const theirs of [
      RAVI.email,
      RAVI.name,
      "+919000000888",
      RAVI.dateOfBirth,
      ravi.userId,
      ravi.profileId,
      ravi.registrationId,
    ]) {
      expect(everything, theirs).not.toContain(theirs);
    }
  });

  it("covers every table the inventory says holds a row naming the person", async () => {
    const h = await createHarness();
    const competition = await paidCompetition(h);
    const asha = await participantWithEntry(h, competition, ASHA);
    const filed = await exportedBy(h, asha);
    const data = JSON.parse(
      (await download(h, asha, filed.requestId)).zip.text("data.json")
    );

    // From the inventory alone: each column that names an account or a
    // profile directly, and the tables where it names this person.
    const mine = [asha.userId, asha.profileId];
    const naming = DATA_INVENTORY.filter(
      (entry) =>
        (entry.subject.kind === "user" ||
          entry.subject.kind === "participant_profile") &&
        entry.subject.via === entry.column &&
        TABLES_BY_NAME.has(entry.table)
    );
    expect(naming.length).toBeGreaterThan(20);
    for (const entry of naming) {
      const table = TABLES_BY_NAME.get(entry.table)!;
      const column = columnNamed(table, entry.column);
      if (column.columnType !== "PgUUID") continue;
      const [found] = await h.db
        .select({ n: sql<number>`count(*)::int` })
        .from(table)
        .where(inArray(column, mine));
      if ((found?.n ?? 0) === 0) continue;
      const where = `${entry.table}.${entry.column}`;
      const covered =
        Object.hasOwn(data.sections, entry.table) ||
        Object.hasOwn(data.references, where) ||
        Object.hasOwn(data.notIncluded, entry.table);
      expect(covered, where).toBe(true);
    }
  });

  it("decrypts only into the archive: the table and the outbox hold no plain values", async () => {
    const h = await createHarness();
    const competition = await paidCompetition(h);
    const asha = await participantWithEntry(h, competition, ASHA);
    await exportedBy(h, asha);

    const [raw] = await h.db
      .select({ dob: participantProfile.dobCiphertext })
      .from(participantProfile)
      .where(eq(participantProfile.id, asha.profileId));
    expect(raw?.dob).not.toContain(ASHA.dateOfBirth);
    const payloads = JSON.stringify(
      await h.db.select({ payload: outbox.payload }).from(outbox)
    );
    expect(payloads).not.toContain(ASHA.dateOfBirth);
    expect(payloads).not.toContain(ASHA.email);
  });

  it("refuses a request that isn't a started access request", async () => {
    const h = await createHarness();
    const officer = await signedInOfficer(h);
    const member = await h.signIn(await h.seed.member());
    const access = await h
      .as(member)
      .submitPrivacyRequest({ type: "access", subject: { kind: "self" } });
    const erasure = await h
      .as(member)
      .submitPrivacyRequest({ type: "erasure", subject: { kind: "self" } });
    if (!access.ok || !erasure.ok) throw new Error("expected requests");

    expect(
      await h.as(officer.actor).buildSubjectExport({ id: access.requestId })
    ).toEqual({ ok: false, error: "not_started" });
    expect(
      await h.as(officer.actor).buildSubjectExport({ id: erasure.requestId })
    ).toEqual({ ok: false, error: "not_access" });
    await h.as(officer.actor).startPrivacyRequest({ id: access.requestId });
    await h.as(officer.actor).buildSubjectExport({ id: access.requestId });
    expect(
      await h.as(officer.actor).buildSubjectExport({ id: access.requestId })
    ).toEqual({ ok: false, error: "already_requested" });
  });

  it("is the grievance officer's alone", async () => {
    const h = await createHarness();
    const member = await h.signIn(await h.seed.member());
    const filed = await h
      .as(member)
      .submitPrivacyRequest({ type: "access", subject: { kind: "self" } });
    if (!filed.ok) throw new Error("expected a request");
    for (const role of ["staff_admin", "super_admin"] as const) {
      const account = await h.seed.member({ email: `${role}@example.test` });
      await h.seed.grant(account, { role, scope: { type: "global" } });
      await expect(
        h
          .as(await h.signIn(account))
          .buildSubjectExport({ id: filed.requestId }),
        role
      ).rejects.toMatchObject({ name: "DomainError", code: "forbidden" });
    }
    await expect(
      h.as(member).buildSubjectExport({ id: filed.requestId })
    ).rejects.toMatchObject({ name: "DomainError", code: "forbidden" });
  });
});

describe("getPrivacyExportLink", () => {
  it("works for the requester until the link expires, then the export is deleted", async () => {
    const h = await createHarness();
    const competition = await paidCompetition(h);
    const asha = await participantWithEntry(h, competition, ASHA);
    const filed = await exportedBy(h, asha);
    const [row] = await requestRows(h);
    const key = row!.exportStorageKey!;
    expect(h.storage.keys(h.deps.files.bucket)).toContain(key);

    h.clock.advance({ hours: 71 });
    expect(
      await h.as(asha.actor).getPrivacyExportLink({ id: filed.requestId })
    ).toMatchObject({ ok: true });
    // Each URL lasts 5 minutes.
    const link = await h
      .as(asha.actor)
      .getPrivacyExportLink({ id: filed.requestId });
    if (!link.ok) throw new Error("expected a link");
    h.clock.advance({ seconds: 301 });
    expect(await h.storage.get(link.url)).toEqual({
      ok: false,
      error: "expired",
    });

    h.clock.advance({ hours: 1 });
    expect(
      await h.as(asha.actor).getPrivacyExportLink({ id: filed.requestId })
    ).toEqual({ ok: false, error: "link_expired" });
    await h.drain();
    expect(h.storage.keys(h.deps.files.bucket)).not.toContain(key);
    expect(
      await h.as(asha.actor).getPrivacyExportLink({ id: filed.requestId })
    ).toEqual({ ok: false, error: "export_deleted" });
    expect(
      await h.as(asha.actor).getMyPrivacyRequest({ id: filed.requestId })
    ).toMatchObject({ export: { state: "expired" } });
  });

  it("refuses another member and the grievance officer: staff never download it", async () => {
    const h = await createHarness();
    const competition = await paidCompetition(h);
    const asha = await participantWithEntry(h, competition, ASHA);
    const filed = await exportedBy(h, asha);
    const other = await h.signIn(await h.seed.member());

    for (const actor of [other, filed.officer.actor, h.visitor()]) {
      await expect(
        h.as(actor).getPrivacyExportLink({ id: filed.requestId })
      ).rejects.toMatchObject({ name: "DomainError", code: "forbidden" });
    }
  });
});
