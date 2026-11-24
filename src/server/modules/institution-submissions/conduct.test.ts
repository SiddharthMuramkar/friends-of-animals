import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { auditLog, competition } from "@/server/db/schema";
import { signInMember } from "@/server/modules/participants/testing";
import { signInStaff } from "@/server/modules/payments/testing";
import { signInCoordinator } from "@/server/modules/registration/testing";
import { createHarness } from "@/test/harness";

import {
  ConductNotCertifiedError,
  isConductCertified,
  requireConductCertified,
} from "./conduct";
import { CONDUCT_STATEMENT_VERSION } from "./domain/conduct-statement";
import { confirmedSchool, otherSchool } from "./testing";

// #87: once per institution registration, a coordinator certifies that the
// competition was run in the school according to FOA's guidelines. The
// certification records who and when, is audit-logged, and finalising the
// school round (#89) requires it.

describe("certifyConduct", () => {
  it("records who certified and when, once, with an audit entry carrying the request", async () => {
    const h = await createHarness();
    const school = await confirmedSchool(h);
    const teacher = await signInCoordinator(
      h,
      school.institutionId,
      { name: "Sunita Kale" },
      { ip: "198.51.100.7", userAgent: "Coordinator browser" }
    );
    const app = h.as(teacher.actor);
    const ids = school.ids;

    const certified = await app.certifyConduct(ids);

    expect(certified).toEqual({ ok: true, certifiedAt: h.clock.now() });
    expect(await app.getConductCertification(ids)).toEqual({
      ok: true,
      reference: school.reference,
      institutionName: "Test School",
      competitionName: "Paws on the Pavement",
      statementVersion: CONDUCT_STATEMENT_VERSION,
      canCertify: false,
      certification: {
        certifiedAt: h.clock.now(),
        certifiedByName: "Sunita Kale",
        statementVersion: CONDUCT_STATEMENT_VERSION,
      },
    });
    const audit = await h.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, "conduct.certified"));
    expect(audit).toEqual([
      expect.objectContaining({
        actorUserId: teacher.userId,
        actorRole: "institution_coordinator",
        entityType: "institution_registration",
        entityId: school.registrationId,
        before: null,
        after: { statementVersion: CONDUCT_STATEMENT_VERSION },
        ip: "198.51.100.7",
        userAgent: "Coordinator browser",
        occurredAt: h.clock.now(),
      }),
    ]);
  });

  it("answers already_certified the second time, keeping the first certification and adding no audit entry", async () => {
    const h = await createHarness();
    const school = await confirmedSchool(h);
    const first = h.clock.now();
    await h.as(school.coordinator.actor).certifyConduct(school.ids);
    h.clock.advance({ hours: 1 });
    const admin = await h.signIn(school.admin);

    expect(await h.as(admin).certifyConduct(school.ids)).toEqual({
      ok: false,
      error: "already_certified",
    });

    expect(await h.as(admin).getConductCertification(school.ids)).toMatchObject(
      {
        ok: true,
        certification: { certifiedAt: first },
      }
    );
    expect(
      await h.db
        .select()
        .from(auditLog)
        .where(eq(auditLog.action, "conduct.certified"))
    ).toHaveLength(1);
  });

  it("needs a confirmed student first", async () => {
    const h = await createHarness();
    const school = await confirmedSchool(h, { students: 0, unconfirmed: 1 });
    const app = h.as(school.coordinator.actor);

    expect(await app.certifyConduct(school.ids)).toEqual({
      ok: false,
      error: "no_confirmed_students",
    });
    expect(await app.getConductCertification(school.ids)).toMatchObject({
      ok: true,
      canCertify: false,
      certification: null,
    });
  });

  it("refuses once the competition is cancelled", async () => {
    const h = await createHarness();
    const school = await confirmedSchool(h);
    await h.db
      .update(competition)
      .set({
        status: "cancelled",
        cancelledAt: h.clock.now(),
        cancelReason: "The venue closed",
      })
      .where(eq(competition.id, school.competition.id));

    expect(
      await h.as(school.coordinator.actor).certifyConduct(school.ids)
    ).toEqual({ ok: false, error: "competition_cancelled" });
  });

  it("finds nothing for a reference of another institution", async () => {
    const h = await createHarness();
    const school = await confirmedSchool(h);
    const other = await otherSchool(h);
    const app = h.as(other.coordinator.actor);
    const ids = {
      institutionId: other.institutionId,
      reference: school.reference,
    };

    expect(await app.certifyConduct(ids)).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(await app.getConductCertification(ids)).toEqual({
      ok: false,
      error: "not_found",
    });
  });
});

describe("who may certify conduct and read it", () => {
  it("allows the institution's coordinators and authorised person", async () => {
    const h = await createHarness();
    const school = await confirmedSchool(h);
    const admin = await h.signIn(school.admin);

    expect(await h.as(admin).getConductCertification(school.ids)).toMatchObject(
      {
        ok: true,
        canCertify: true,
      }
    );
    expect(await h.as(admin).certifyConduct(school.ids)).toMatchObject({
      ok: true,
    });
    expect(
      await h.as(school.coordinator.actor).getConductCertification(school.ids)
    ).toMatchObject({
      ok: true,
      certification: { certifiedByName: expect.any(String) },
    });
  });

  it("refuses another institution's coordinator, a participant, a guardian, a member, a competition manager and a visitor", async () => {
    const h = await createHarness();
    const school = await confirmedSchool(h);
    const other = await otherSchool(h);
    const member = await signInMember(h, { name: "Ravi Kumar" });
    const family = await h.seed.guardian({
      children: [{ fullName: "Isha Desai", age: 9 }],
    });
    const manager = await signInStaff(h, "competition_manager");
    const actors = [
      other.coordinator.actor,
      member.actor,
      await h.signIn(family.account),
      manager.actor,
      h.visitor(),
    ];

    for (const actor of actors) {
      await expect(
        h.as(actor).certifyConduct(school.ids)
      ).rejects.toMatchObject({ code: "forbidden" });
      await expect(
        h.as(actor).getConductCertification(school.ids)
      ).rejects.toMatchObject({ code: "forbidden" });
    }
    expect(await isConductCertified(h.db, school.registrationId)).toBe(false);
  });
});

describe("requireConductCertified, for finalising the school round (#89)", () => {
  it("throws conduct_not_certified until the registration is certified, then passes", async () => {
    const h = await createHarness();
    const school = await confirmedSchool(h);
    const other = await confirmedSchool(h, { code: "SKIES27", name: "Other" });

    const before = requireConductCertified(h.db, school.registrationId);
    await expect(before).rejects.toThrow(ConductNotCertifiedError);
    await expect(before).rejects.toMatchObject({
      code: "conduct_not_certified",
    });
    await h.as(school.coordinator.actor).certifyConduct(school.ids);

    await expect(
      requireConductCertified(h.db, school.registrationId)
    ).resolves.toBeUndefined();
    expect(await isConductCertified(h.db, school.registrationId)).toBe(true);
    expect(await isConductCertified(h.db, other.registrationId)).toBe(false);
  });
});
