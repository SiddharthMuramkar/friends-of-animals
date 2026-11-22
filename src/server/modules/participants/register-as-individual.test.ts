import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { auditLog, consentEvent, participantProfile } from "@/server/db/schema";
import { DomainError } from "@/server/errors";
import { createHarness } from "@/test/harness";

import {
  adultForm,
  openToIndividuals,
  participantRows,
  signInMember,
} from "./testing";

const PARTICIPANT_ID = /^FOA-P-\d{2}[0-9A-HJKMNP-TV-Z]{6}$/;

describe("registerAsIndividual", () => {
  it("gives an adult their own profile with a Participant ID and a registration waiting for payment", async () => {
    const h = await createHarness();
    const competition = await openToIndividuals(h);
    const asha = await signInMember(h, { name: "Asha Rao" });

    const result = await h
      .as(asha.actor)
      .registerAsIndividual(adultForm(competition));

    expect(result).toEqual({
      ok: true,
      registrationId: expect.any(String),
      participantCode: expect.stringMatching(PARTICIPANT_ID),
      status: "pending_payment",
    });
    if (!result.ok) return;
    // Issued on 15 January 2027 in India.
    expect(result.participantCode.slice(0, 8)).toBe("FOA-P-27");
    const listed = await h.as(asha.actor).listMyRegistrations();
    expect(listed).toEqual([
      expect.objectContaining({
        registrationId: result.registrationId,
        competition: { name: "Seed competition 1", slug: competition.slug },
        route: "individual",
        status: "pending_payment",
        participantCode: result.participantCode,
        registrationNumber: null,
      }),
    ]);
  });

  it("takes the year of the Participant ID from India's calendar", async () => {
    const h = await createHarness();
    // 00:30 IST on 1 January 2027 is still 31 December 2026 in UTC.
    h.clock.set(new Date("2026-12-31T19:00:00.000Z"));
    const competition = await openToIndividuals(h);
    const member = await signInMember(h);

    const result = await h
      .as(member.actor)
      .registerAsIndividual(adultForm(competition));

    expect(result).toMatchObject({ ok: true });
    if (result.ok) expect(result.participantCode.slice(0, 8)).toBe("FOA-P-27");
  });

  it("reuses the profile and Participant ID for a second competition, with the latest details", async () => {
    const h = await createHarness();
    const first = await openToIndividuals(h);
    const second = await openToIndividuals(h);
    const asha = await signInMember(h);

    const one = await h.as(asha.actor).registerAsIndividual(adultForm(first));
    const two = await h
      .as(asha.actor)
      .registerAsIndividual(adultForm(second, { city: "Mumbai" }));

    expect(one.ok && two.ok).toBe(true);
    if (!one.ok || !two.ok) return;
    expect(two.participantCode).toBe(one.participantCode);
    expect(two.registrationId).not.toBe(one.registrationId);
    const profiles = await h.db.select().from(participantProfile);
    expect(profiles).toHaveLength(1);
    expect(profiles[0]).toMatchObject({
      ownerKind: "self",
      ownerUserId: asha.userId,
      managingInstitutionId: null,
      fullName: "Asha Rao",
      pinCode: "411038",
      city: "Mumbai",
      state: "Maharashtra",
      country: "IN",
      schoolName: null,
    });
  });

  it("records consent to the exact versions the competition attached", async () => {
    const h = await createHarness();
    const competition = await openToIndividuals(h);
    const asha = await signInMember(h);

    await h.as(asha.actor).registerAsIndividual(adultForm(competition));

    const events = await h.db
      .select()
      .from(consentEvent)
      .where(eq(consentEvent.subjectId, asha.userId));
    expect(
      events
        .map(
          ({
            subjectType,
            giverUserId,
            purpose,
            documentId,
            action,
            method,
          }) => ({
            subjectType,
            giverUserId,
            purpose,
            documentId,
            action,
            method,
          })
        )
        .toSorted((a, b) => a.purpose.localeCompare(b.purpose))
    ).toEqual([
      {
        subjectType: "user",
        giverUserId: asha.userId,
        purpose: "competition_terms",
        documentId: competition.documents[0],
        action: "given",
        method: "web_form",
      },
      {
        subjectType: "user",
        giverUserId: asha.userId,
        purpose: "privacy_notice",
        documentId: competition.documents[1],
        action: "given",
        method: "web_form",
      },
    ]);
  });

  it("keeps the date of birth and phone as ciphertext in the table", async () => {
    const h = await createHarness();
    const competition = await openToIndividuals(h);
    const asha = await signInMember(h);

    await h.as(asha.actor).registerAsIndividual(adultForm(competition));

    const raw = await h.db.execute<{ dob: string; phone: string }>(
      sql`SELECT dob_ciphertext AS dob, phone_ciphertext AS phone FROM participant_profile`
    );
    const [row] = raw.rows;
    expect(row?.dob).toBeTruthy();
    expect(row?.dob).not.toContain("1994");
    expect(row?.phone).toBeTruthy();
    expect(row?.phone).not.toContain("90000");
    expect(row?.phone).not.toContain("777");
  });

  it("writes an audit entry with ids only", async () => {
    const h = await createHarness();
    const competition = await openToIndividuals(h);
    const asha = await signInMember(h);

    const result = await h
      .as(asha.actor)
      .registerAsIndividual(adultForm(competition));

    if (!result.ok) throw new Error(JSON.stringify(result));
    const [entry] = await h.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, "registration.individual_registered"));
    expect(entry).toMatchObject({
      actorUserId: asha.userId,
      entityType: "registration",
      entityId: result.registrationId,
    });
    const recorded = JSON.stringify(entry);
    expect(recorded).not.toContain("Asha");
    expect(recorded).not.toContain("1994");
    expect(recorded).not.toContain("411038");
  });

  it.each([
    [
      "registration isn't open",
      { status: "published" as const },
      {},
      "registration_closed",
    ],
    [
      "the competition takes institutions only",
      { participation: "institutions" as const },
      {},
      "institutions_only",
    ],
    ["the individual fee isn't set", { fee: null }, {}, "fee_not_set"],
    [
      "the date of birth isn't a real date",
      {},
      { dateOfBirth: "1994-02-30" },
      "dob_invalid",
    ],
    [
      "the date of birth is in the future",
      {},
      { dateOfBirth: "2027-01-16" },
      "dob_invalid",
    ],
    [
      "no age group takes them",
      { ageGroups: [{ label: "13–17", minAge: 13, maxAge: 17 }] },
      {},
      "outside_age_groups",
    ],
    [
      "a required document isn't agreed to",
      {},
      { consents: [] },
      "consent_missing",
    ],
  ])("refuses, writing nothing, when %s", async (_, options, change, error) => {
    const h = await createHarness();
    const competition = await openToIndividuals(h, options);
    const member = await signInMember(h);
    const before = await participantRows(h);

    const result = await h
      .as(member.actor)
      .registerAsIndividual(adultForm(competition, change));

    expect(result).toEqual({ ok: false, error });
    expect(await participantRows(h)).toEqual(before);
    expect(await h.db.select().from(consentEvent)).toEqual([]);
  });

  it("refuses a second registration for the same competition", async () => {
    const h = await createHarness();
    const competition = await openToIndividuals(h);
    const member = await signInMember(h);
    await h.as(member.actor).registerAsIndividual(adultForm(competition));
    const before = await participantRows(h);

    const again = await h
      .as(member.actor)
      .registerAsIndividual(adultForm(competition));

    expect(again).toEqual({ ok: false, error: "already_registered" });
    expect(await participantRows(h)).toEqual(before);
  });

  it("refuses a competition that isn't published, as not found", async () => {
    const h = await createHarness();
    const draft = await openToIndividuals(h, { status: "draft" });
    const member = await signInMember(h);

    expect(
      await h.as(member.actor).registerAsIndividual(adultForm(draft))
    ).toEqual({ ok: false, error: "not_found" });
    expect(
      await h
        .as(member.actor)
        .registerAsIndividual(
          adultForm(draft, { competitionSlug: "no-such-competition" })
        )
    ).toEqual({ ok: false, error: "not_found" });
  });

  describe("an under-18", () => {
    // The harness's clock: 10:00 IST on 15 January 2027.
    it.each([
      ["turns 18 today in India", "2009-01-15", true],
      ["turns 18 tomorrow", "2009-01-16", false],
    ])("who %s", async (_, dateOfBirth, allowed) => {
      const h = await createHarness();
      const competition = await openToIndividuals(h);
      const member = await signInMember(h);

      const result = await h
        .as(member.actor)
        .registerAsIndividual(adultForm(competition, { dateOfBirth }));

      expect(result.ok).toBe(allowed);
      if (!allowed) expect(result).toEqual({ ok: false, error: "minor" });
    });

    it("born on 29 February turns 18 on 1 March in a year without one", async () => {
      const h = await createHarness();
      const competition = await openToIndividuals(h);
      const member = await signInMember(h);
      const form = adultForm(competition, { dateOfBirth: "2008-02-29" });

      h.clock.set(new Date("2026-02-28T06:30:00.000Z"));
      expect(await h.as(member.actor).registerAsIndividual(form)).toEqual({
        ok: false,
        error: "minor",
      });
      h.clock.set(new Date("2026-03-01T06:30:00.000Z"));
      expect(await h.as(member.actor).registerAsIndividual(form)).toMatchObject(
        {
          ok: true,
        }
      );
    });

    it("is refused with nothing written", async () => {
      const h = await createHarness();
      const competition = await openToIndividuals(h);
      const member = await signInMember(h);
      const before = await participantRows(h);

      await h
        .as(member.actor)
        .registerAsIndividual(
          adultForm(competition, { dateOfBirth: "2012-03-03" })
        );

      expect(await participantRows(h)).toEqual(before);
    });
  });

  it("names every field at fault in the form", async () => {
    const h = await createHarness();
    const competition = await openToIndividuals(h);
    const member = await signInMember(h);

    expect(
      await h.as(member.actor).registerAsIndividual(
        adultForm(competition, {
          fullName: " ",
          phone: "12345",
          pinCode: "011038",
        })
      )
    ).toEqual({
      ok: false,
      error: "invalid_input",
      fields: ["fullName", "phone", "pinCode"],
    });
  });

  it("takes a postal code from another country, with an Indian mobile", async () => {
    const h = await createHarness();
    const competition = await openToIndividuals(h);
    const member = await signInMember(h);

    const result = await h.as(member.actor).registerAsIndividual(
      adultForm(competition, {
        country: "GB",
        pinCode: "SW1A 1AA",
        city: "London",
        state: "England",
      })
    );

    expect(result).toMatchObject({ ok: true });
  });

  it("is for signed-in members only", async () => {
    const h = await createHarness();
    const competition = await openToIndividuals(h);

    await expect(
      h.as(h.visitor()).registerAsIndividual(adultForm(competition))
    ).rejects.toThrow(DomainError);
    expect(await h.db.select().from(participantProfile)).toEqual([]);
  });
});
