import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import type { Actor } from "@/server/actor";
import { auditLog, institutionRegistration } from "@/server/db/schema";
import { DomainError } from "@/server/errors";
import type { CompetitionFields } from "@/server/modules/competitions";
import {
  signedInStaff,
  validRegistration,
} from "@/server/modules/institutions/testing";
import { createHarness, type Harness } from "@/test/harness";
import { seedInstitution } from "@/test/institutions";

import { openCompetition, signInCoordinator } from "./testing";

const REFERENCE = /^[A-Z]{3,6}\d{2}-I-[0-9A-HJKMNP-TV-Z]{5}$/;
/** Where seedInstitution's principal reads email (validRegistration). */
const PRINCIPAL = validRegistration().principalEmail;

// Key dates still ahead of the harness clock (2027-01-15). The form takes
// IST; 09:00 IST is 03:30Z.
const KEY_DATES: CompetitionFields["keyDates"] = {
  registration_opens: "2027-02-01T09:00",
  registration_closes: "2027-02-20T18:00",
  submissions_close: "2027-02-28T23:59",
  school_round_closes: "2027-03-10T18:00",
};
const OPENS = new Date("2027-02-01T03:30:00.000Z");
const CLOSES = new Date("2027-02-20T12:30:00.000Z");

async function registrationCount(h: Harness) {
  const rows = await h.db
    .select({ id: institutionRegistration.id })
    .from(institutionRegistration);
  return rows.length;
}

describe("registerInstitutionForCompetition", () => {
  it("registers a verified institution and gives it a reference that starts with the competition's code", async () => {
    const h = await createHarness();
    const { institution: x } = await seedInstitution(h);
    const { actor, userId } = await signInCoordinator(h, x.id);
    const competition = await openCompetition(h, { code: "PAWS27" });

    const result = await h.as(actor).registerInstitutionForCompetition({
      institutionId: x.id,
      competitionId: competition.id,
    });

    expect(result).toEqual({
      ok: true,
      registrationId: expect.any(String),
      reference: expect.stringMatching(/^PAWS27-I-/),
    });
    if (!result.ok) return;
    expect(result.reference).toMatch(REFERENCE);
    expect(await h.db.select().from(institutionRegistration)).toEqual([
      {
        id: result.registrationId,
        institutionId: x.id,
        competitionId: competition.id,
        reference: result.reference,
        status: "active",
        registeredBy: userId,
        participationDeclaredAt: null,
        participationDeclaredByUserId: null,
        createdAt: h.clock.now(),
        updatedAt: h.clock.now(),
      },
    ]);
  });

  it("refuses a second registration of the same institution, by the same or another coordinator", async () => {
    const h = await createHarness();
    const { institution: x } = await seedInstitution(h);
    const first = await signInCoordinator(h, x.id);
    const second = await signInCoordinator(h, x.id);
    const competition = await openCompetition(h);
    const input = { institutionId: x.id, competitionId: competition.id };
    const registered = await h
      .as(first.actor)
      .registerInstitutionForCompetition(input);

    const again = await h
      .as(first.actor)
      .registerInstitutionForCompetition(input);
    const byAnother = await h
      .as(second.actor)
      .registerInstitutionForCompetition(input);

    expect(again).toEqual({ ok: false, error: "already_registered" });
    expect(byAnother).toEqual({ ok: false, error: "already_registered" });
    expect(
      await h.db
        .select({ id: institutionRegistration.id })
        .from(institutionRegistration)
    ).toEqual([{ id: registered.ok && registered.registrationId }]);
  });

  describe("the registration window", () => {
    /** A published competition whose status jobs move it at KEY_DATES. */
    function scheduledCompetition(h: Harness) {
      return h.seed.competition({
        status: "published",
        participation: "both",
        keyDates: KEY_DATES,
      });
    }

    it("refuses before registration opens, registers once it opens and refuses after it closes", async () => {
      const h = await createHarness();
      const { institution: x } = await seedInstitution(h, { name: "X" });
      const { institution: y } = await seedInstitution(h, { name: "Y" });
      const { actor: forX } = await signInCoordinator(h, x.id);
      const { actor: forY } = await signInCoordinator(h, y.id);
      const { id: competitionId } = await scheduledCompetition(h);

      h.clock.set(new Date(OPENS.getTime() - 1));
      await h.drain();
      expect(
        await h.as(forX).registerInstitutionForCompetition({
          institutionId: x.id,
          competitionId,
        })
      ).toEqual({ ok: false, error: "not_open_yet" });
      expect(await registrationCount(h)).toBe(0);

      h.clock.set(OPENS);
      await h.drain();
      expect(
        await h.as(forX).registerInstitutionForCompetition({
          institutionId: x.id,
          competitionId,
        })
      ).toMatchObject({ ok: true });

      h.clock.set(CLOSES);
      await h.drain();
      expect(
        await h.as(forY).registerInstitutionForCompetition({
          institutionId: y.id,
          competitionId,
        })
      ).toEqual({ ok: false, error: "closed" });
      expect(await registrationCount(h)).toBe(1);
    });

    it("refuses after the closing instant even while a late worker has not closed registration", async () => {
      const h = await createHarness();
      const { institution: x } = await seedInstitution(h);
      const { actor } = await signInCoordinator(h, x.id);
      const { id: competitionId } = await scheduledCompetition(h);
      h.clock.set(OPENS);
      await h.drain();

      // The close job is due, but nothing has drained it yet.
      h.clock.set(CLOSES);
      const result = await h.as(actor).registerInstitutionForCompetition({
        institutionId: x.id,
        competitionId,
      });

      expect(result).toEqual({ ok: false, error: "closed" });
      expect(await registrationCount(h)).toBe(0);
    });

    it("treats a draft competition, or none, as not found", async () => {
      const h = await createHarness();
      const { institution: x } = await seedInstitution(h);
      const { actor } = await signInCoordinator(h, x.id);
      const draft = await h.seed.competition({ participation: "institutions" });

      for (const competitionId of [
        draft.id,
        "01938a00-0000-7000-8000-00000000dead",
      ]) {
        expect(
          await h.as(actor).registerInstitutionForCompetition({
            institutionId: x.id,
            competitionId,
          })
        ).toEqual({ ok: false, error: "not_found" });
      }
      expect(await registrationCount(h)).toBe(0);
    });
  });

  it("refuses a competition only individuals can enter", async () => {
    const h = await createHarness();
    const { institution: x } = await seedInstitution(h);
    const { actor } = await signInCoordinator(h, x.id);
    const competition = await openCompetition(h, {
      participation: "individuals",
    });

    const result = await h.as(actor).registerInstitutionForCompetition({
      institutionId: x.id,
      competitionId: competition.id,
    });

    expect(result).toEqual({ ok: false, error: "institutions_not_accepted" });
    expect(await registrationCount(h)).toBe(0);
  });

  it.each(["pending_verification", "rejected", "suspended"] as const)(
    "refuses an institution that is %s, though its people keep their roles",
    async (status) => {
      const h = await createHarness();
      const { institution: x, admin } = await seedInstitution(h, { status });
      const { actor: coordinator } = await signInCoordinator(h, x.id);
      const authorisedPerson = await h.signIn(admin);
      const competition = await openCompetition(h);
      const input = { institutionId: x.id, competitionId: competition.id };

      for (const actor of [coordinator, authorisedPerson]) {
        expect(
          await h.as(actor).registerInstitutionForCompetition(input)
        ).toEqual({ ok: false, error: "institution_not_verified" });
      }
      expect(await registrationCount(h)).toBe(0);
    }
  );

  describe("the principal's message", () => {
    it("tells the principal, by email, once the outbox delivers", async () => {
      const h = await createHarness();
      const { institution: x } = await seedInstitution(h, {
        name: "Green Valley School",
      });
      const { actor } = await signInCoordinator(h, x.id, {
        name: "Meena Iyer",
      });
      const competition = await openCompetition(h, {
        code: "PAWS27",
        name: "Paws on the Pavement",
      });
      const result = await h.as(actor).registerInstitutionForCompetition({
        institutionId: x.id,
        competitionId: competition.id,
      });
      if (!result.ok) throw new Error(result.error);
      expect(h.email.inbox(PRINCIPAL)).toEqual([]);

      await h.drain();

      const inbox = h.email.inbox(PRINCIPAL);
      expect(inbox).toHaveLength(1);
      expect(inbox[0]!.subject).toBe(
        "Green Valley School is registered for Paws on the Pavement"
      );
      for (const words of [
        "Green Valley School",
        "Paws on the Pavement",
        result.reference,
        "Meena Iyer",
      ]) {
        expect(inbox[0]!.text).toContain(words);
      }
    });

    it("sends nothing when it refuses", async () => {
      const h = await createHarness();
      const { institution: x } = await seedInstitution(h);
      const { actor } = await signInCoordinator(h, x.id);
      const competition = await openCompetition(h, {
        participation: "individuals",
      });
      await h.as(actor).registerInstitutionForCompetition({
        institutionId: x.id,
        competitionId: competition.id,
      });

      await h.drain();

      expect(h.email.inbox(PRINCIPAL)).toEqual([]);
    });
  });

  describe("the audit log", () => {
    async function registrationEntries(h: Harness) {
      return h.db
        .select()
        .from(auditLog)
        .where(eq(auditLog.action, "registration.institution_registered"));
    }

    it("records who registered which institution for which competition, by ids", async () => {
      const h = await createHarness();
      const { institution: x } = await seedInstitution(h);
      const { actor, userId } = await signInCoordinator(
        h,
        x.id,
        {},
        { ip: "198.51.100.7", userAgent: "Staffroom browser" }
      );
      const competition = await openCompetition(h);

      const result = await h.as(actor).registerInstitutionForCompetition({
        institutionId: x.id,
        competitionId: competition.id,
      });
      if (!result.ok) throw new Error(result.error);

      expect(await registrationEntries(h)).toEqual([
        expect.objectContaining({
          actorKind: "user",
          actorUserId: userId,
          actorRole: "institution_coordinator",
          entityType: "institution_registration",
          entityId: result.registrationId,
          before: null,
          after: {
            institutionId: x.id,
            competitionId: competition.id,
            reference: result.reference,
          },
          ip: "198.51.100.7",
          userAgent: "Staffroom browser",
          occurredAt: h.clock.now(),
        }),
      ]);
    });

    it("records nothing when it refuses", async () => {
      const h = await createHarness();
      const { institution: x } = await seedInstitution(h);
      const { actor } = await signInCoordinator(h, x.id);
      const competition = await openCompetition(h);
      const input = { institutionId: x.id, competitionId: competition.id };
      await h.as(actor).registerInstitutionForCompetition(input);

      const again = await h.as(actor).registerInstitutionForCompetition(input);

      expect(again).toEqual({ ok: false, error: "already_registered" });
      expect(await registrationEntries(h)).toHaveLength(1);
    });
  });

  describe("who may register", () => {
    it("lets the institution's authorised person register it", async () => {
      const h = await createHarness();
      const { institution: x, admin } = await seedInstitution(h);
      const actor = await h.signIn(admin);
      const competition = await openCompetition(h);

      const result = await h.as(actor).registerInstitutionForCompetition({
        institutionId: x.id,
        competitionId: competition.id,
      });

      expect(result).toMatchObject({ ok: true });
      expect(await registrationCount(h)).toBe(1);
    });

    const OUTSIDERS: [string, (h: Harness) => Promise<Actor>][] = [
      [
        "a coordinator of another institution",
        async (h) => {
          const { institution: y } = await seedInstitution(h, { name: "Y" });
          return (await signInCoordinator(h, y.id)).actor;
        },
      ],
      [
        "the authorised person of another institution",
        async (h) => {
          const { admin } = await seedInstitution(h, { name: "Y" });
          return h.signIn(admin);
        },
      ],
      ["a member", async (h) => h.signIn(await h.seed.member())],
      ["a staff admin", (h) => signedInStaff(h)],
      ["a super admin", (h) => signedInStaff(h, "super_admin")],
      ["a visitor", async (h) => h.visitor()],
    ];

    it.each(OUTSIDERS)("refuses %s", async (_who, actorFor) => {
      const h = await createHarness();
      const { institution: x } = await seedInstitution(h, { name: "X" });
      const competition = await openCompetition(h);
      const actor = await actorFor(h);

      await expect(
        h.as(actor).registerInstitutionForCompetition({
          institutionId: x.id,
          competitionId: competition.id,
        })
      ).rejects.toThrow(DomainError);
      expect(await registrationCount(h)).toBe(0);
    });
  });
});
