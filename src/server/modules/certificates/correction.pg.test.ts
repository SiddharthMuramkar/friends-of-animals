import { afterAll, beforeAll, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { createPgWorld, type PgWorld } from "@/test/pg";
import {
  certificate,
  competitionAgeGroup,
  registration,
} from "../../db/schema";
import { SEED_INSTITUTIONS } from "../../seed/institutions";
import { SEED_STUDENTS } from "../../seed/registration";
import { managerOf } from "../judging/testing";
import { uuidv7 } from "../../ids";
import { insertCertificate } from "./issue";

let world: PgWorld;
beforeAll(() => {
  world = createPgWorld();
});
afterAll(async () => world.close());
const worker = { kind: "system", process: "worker" } as const;

it("serializes duplicate correction and archive requests; a concurrent build cannot sign the revoked manifest", async () => {
  await world.seed.preview();
  const code = `CA${Array.from({ length: 4 }, () => String.fromCharCode(65 + Math.floor(Math.random() * 26))).join("")}27`;
  const comp = await world.seed.competition({
    code,
    name: code,
    status: "results_published",
  });
  const school = await world.seed.institutionRegistration({
    institutionId: SEED_INSTITUTIONS.verified.id,
    competitionId: comp.id,
  });
  const [group] = await world.db
    .select()
    .from(competitionAgeGroup)
    .where(eq(competitionAgeGroup.competitionId, comp.id));
  const now = world.clock.now();
  const registrationId = uuidv7(now);
  await world.db.insert(registration).values({
    id: registrationId,
    participantProfileId: SEED_STUDENTS[0]!.profileId,
    competitionId: comp.id,
    institutionRegistrationId: school.id,
    route: "institution",
    ageGroupId: group!.id,
    status: "confirmed",
    registrationNumber: `${comp.code}-R-5EED01`,
    createdAt: now,
    updatedAt: now,
  });
  const old = await insertCertificate(world.db, world.clock, {
    competitionId: comp.id,
    registrationId,
    participantProfileId: SEED_STUDENTS[0]!.profileId,
    type: "participation",
    nameSnapshot: "Student name",
  });
  const member = await world.seed.member();
  await world.seed.grant(member, managerOf(comp.id));
  await world.seed.authenticator(member);
  const manager = world.as(
    await world.signedIn(member, { secondFactor: true })
  );
  const coordAccount = await world.seed.member();
  await world.seed.grant(coordAccount, {
    role: "institution_coordinator",
    scope: { type: "institution", id: SEED_INSTITUTIONS.verified.id },
  });
  const coord = world.as(await world.signedIn(coordAccount));
  const system = world.as(worker);
  await system.renderCertificate({ certificateId: old.id });
  const ref = {
    institutionId: SEED_INSTITUTIONS.verified.id,
    reference: school.reference,
  };
  const requests = await world.sql.begin(async (blocker) => {
    await blocker`select id from competition where id=${comp.id} for update`;
    const a = coord.requestInstitutionCertificateArchive(ref);
    a.catch(() => {});
    await world.waitForLockWaiters(1);
    const b = coord.requestInstitutionCertificateArchive(ref);
    b.catch(() => {});
    await world.waitForLockWaiters(2);
    return { a, b };
  });
  const [a, b] = await Promise.all([requests.a, requests.b]);
  expect(a).toEqual(b);
  if (!a.ok) throw Error("Archive unavailable");
  const races = await world.sql.begin(async (blocker) => {
    await blocker`select id from competition where id=${comp.id} for update`;
    const build = system.buildInstitutionCertificateArchive({
      archiveId: a.archiveId,
    });
    build.catch(() => {});
    await world.waitForLockWaiters(1);
    const correction1 = manager.reissueCertificate({
      certificateId: old.id,
      reason: "Spelling correction",
      recipientName: "Corrected student",
    });
    correction1.catch(() => {});
    await world.waitForLockWaiters(2);
    const correction2 = manager.reissueCertificate({
      certificateId: old.id,
      reason: "Duplicate correction",
      recipientName: "Another name",
    });
    correction2.catch(() => {});
    await world.waitForLockWaiters(3);
    return { build, correction1, correction2 };
  });
  await races.build;
  const corrections = await Promise.all([races.correction1, races.correction2]);
  expect(corrections.filter((c) => c.ok)).toHaveLength(1);
  expect(corrections.filter((c) => !c.ok)).toEqual([
    { ok: false, error: "not_issued" },
  ]);
  expect(await manager.listCertificates({ competitionId: comp.id })).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: old.id, status: "superseded" }),
      expect.objectContaining({
        status: "issued",
        type: "participation",
        renderStatus: "pending",
      }),
    ])
  );
  expect(
    await coord.getInstitutionCertificateArchiveLink({ archiveId: a.archiveId })
  ).toMatchObject({ ok: false });
  const rows = await world.db
    .select()
    .from(certificate)
    .where(
      and(
        eq(certificate.registrationId, registrationId),
        eq(certificate.status, "issued")
      )
    );
  expect(rows).toHaveLength(1);
  expect(rows[0]!.number).not.toBe(old.number);
});
