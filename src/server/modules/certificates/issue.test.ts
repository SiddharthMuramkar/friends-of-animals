import { insertCertificate } from "./issue";
import { eq } from "drizzle-orm";
import {
  certificate,
  competition,
  judgingRound,
  registration,
  resultRelease,
} from "../../db/schema";
import { createdEntry, shortlistOnlySchool } from "../school-round/testing";
import { TIE_BREAK_RULE } from "../judging/domain/ranking";
import { expect, it } from "vitest";
import { createHarness } from "@/test/harness";
import { uuidv7 } from "../../ids";
const worker = { kind: "system", process: "worker" } as const;
it("refuses untrusted publication and never issues from a missing release", async () => {
  const h = await createHarness();
  const input = {
    competitionId: uuidv7(h.clock.now()),
    releaseId: uuidv7(h.clock.now()),
    publishedAt: h.clock.now().toISOString(),
  };
  await expect(
    h.as(h.visitor()).issueCertificates(input)
  ).rejects.toMatchObject({ code: "forbidden" });
  expect(await h.as(worker).issueCertificates(input)).toEqual({ issued: 0 });
});

// A decided school round may have no digital entry for a registrant at all.
// Results facts below are the already committed publication fixture; the
// separate results/releases journey proves that real publishing emits the job.
it("issues participation to a shortlist-only school's unuploaded pupil after the school decides", async () => {
  const h = await createHarness();
  const school = await shortlistOnlySchool(h, { students: 3 });
  await createdEntry(h, school, 1, { position: 1 });
  await h.drain();
  const coordinator = h.as(school.coordinator.actor);
  await coordinator.recordPanel({
    ...school.ref,
    members: [{ fullName: "Lata Kulkarni", designation: "Art teacher" }],
  });
  await coordinator.certifyConduct(school.ref);
  expect(
    await coordinator.finaliseSchoolRound({
      ...school.ref,
      judgingAttested: true,
    })
  ).toMatchObject({ ok: true, shortlisted: 1, notShortlisted: 2 });
  const now = h.clock.now(),
    id = uuidv7(now),
    releaseId = uuidv7(now),
    competitionId = school.competition.id;
  await h.db
    .update(competition)
    .set({ status: "results_published" })
    .where(eq(competition.id, competitionId));
  await h.db.insert(judgingRound).values({
    id,
    competitionId,
    name: "Final",
    nameKey: "final",
    status: "locked",
    lockedAt: now,
    lockOverrideReason: "No complete scores",
    tieBreakRule: TIE_BREAK_RULE,
    createdAt: now,
    updatedAt: now,
  });
  const yesterday = new Date(now.getTime() - 86400000);
  await h.db.insert(resultRelease).values({
    id: releaseId,
    competitionId,
    sourceRoundId: id,
    status: "published",
    preparedAt: yesterday,
    approvedAt: yesterday,
    publishAt: now,
    publishedAt: now,
    contentHash: "fixture",
    deliveryNote: "FOA contacts families",
  });
  expect(
    await h.as(worker).issueCertificates({
      competitionId,
      releaseId,
      publishedAt: now.toISOString(),
    })
  ).toEqual({ issued: 4 });
  const rows = await h.db
    .select()
    .from(certificate)
    .where(eq(certificate.sourceReleaseId, releaseId));
  expect(rows.filter((r) => r.type === "participation")).toHaveLength(3);
  expect(rows.filter((r) => r.type === "school_merit")).toHaveLength(1);
  const regs = await h.db
    .select()
    .from(registration)
    .where(eq(registration.competitionId, competitionId));
  expect(new Set(rows.map((r) => r.registrationId))).toEqual(
    new Set(regs.map((r) => r.id))
  );
});

it("retries a forced number collision against the real unique constraint at the IST year boundary", async () => {
  const h = await createHarness();
  const school = await shortlistOnlySchool(h, { students: 1 });
  const [row] = await h.db
    .select()
    .from(registration)
    .where(eq(registration.competitionId, school.competition.id));
  if (!row) throw Error("missing registration fixture");
  // 1 Jan 00:01 in India, but still 31 Dec in UTC.
  const clock = { now: () => new Date("2026-12-31T18:31:00.000Z") };
  const fixed = (byte: number) => () => new Uint8Array(10).fill(byte);
  const first = await insertCertificate(
    h.db,
    clock,
    {
      type: "participation",
      registrationId: row.id,
      competitionId: row.competitionId,
      participantProfileId: row.participantProfileId,
      nameSnapshot: "Participant",
    },
    fixed(0)
  );
  let draws = 0;
  const second = await insertCertificate(
    h.db,
    clock,
    {
      type: "volunteer_service",
      participantProfileId: row.participantProfileId,
      nameSnapshot: "Participant",
    },
    () => new Uint8Array(10).fill(draws++ === 0 ? 0 : 1)
  );
  expect(first.number).toBe("FOA-C-27-0000000000");
  expect(second.number).toBe("FOA-C-27-1111111111");
  expect(draws).toBe(2);
});
