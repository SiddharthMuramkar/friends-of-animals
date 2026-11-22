import { describe, expect, it } from "vitest";

import type { Actor } from "@/server/actor";
import { DomainError } from "@/server/errors";
import { signedInStaff } from "@/server/modules/institutions/testing";
import { createHarness, type Harness } from "@/test/harness";
import { seedInstitution } from "@/test/institutions";

import { signInCoordinator } from "./testing";

// The harness clock starts at 2027-01-15T04:30Z. Key dates are typed in
// IST, as the admin form takes them: 09:00 IST is 03:30Z, 18:00 IST is
// 12:30Z.

describe("listCompetitionsForInstitution", () => {
  it("lists the published competitions taking institutions, open first, then the soonest to open, with the institution's reference", async () => {
    const h = await createHarness();
    const { institution: x } = await seedInstitution(h, {
      name: "Green Valley School",
    });
    const { actor } = await signInCoordinator(h, x.id);
    const open = await h.seed.competition({
      status: "registration_open",
      participation: "institutions",
      code: "OPEN27",
      name: "Open Now",
      keyDates: {
        registration_opens: "2027-01-10T09:00",
        registration_closes: "2027-02-10T18:00",
        submissions_close: "2027-02-20T18:00",
        school_round_closes: "2027-03-01T18:00",
      },
    });
    const later = await h.seed.competition({
      status: "published",
      participation: "both",
      code: "LATER27",
      name: "Opens Later",
      keyDates: {
        registration_opens: "2027-03-01T09:00",
        registration_closes: "2027-04-01T18:00",
        submissions_close: "2027-04-10T18:00",
        school_round_closes: "2027-04-20T18:00",
      },
    });
    const sooner = await h.seed.competition({
      status: "published",
      participation: "institutions",
      code: "SOON27",
      name: "Opens Soon",
      keyDates: {
        registration_opens: "2027-02-01T09:00",
        registration_closes: "2027-03-01T18:00",
        submissions_close: "2027-03-10T18:00",
        school_round_closes: "2027-03-20T18:00",
      },
    });
    const past = await h.seed.competition({
      status: "registration_closed",
      participation: "both",
      code: "PAST26",
      name: "Already Closed",
      keyDates: {
        registration_opens: "2026-10-01T09:00",
        registration_closes: "2026-11-01T18:00",
        submissions_close: "2026-11-10T18:00",
        school_round_closes: "2026-11-20T18:00",
      },
    });
    // Neither is listed: one takes individuals only, one is a draft.
    await h.seed.competition({
      status: "registration_open",
      participation: "individuals",
      code: "SOLO27",
    });
    await h.seed.competition({
      participation: "institutions",
      code: "DRAFT27",
    });
    const registered = await h.as(actor).registerInstitutionForCompetition({
      institutionId: x.id,
      competitionId: open.id,
    });
    if (!registered.ok) throw new Error(registered.error);

    const result = await h
      .as(actor)
      .listCompetitionsForInstitution({ institutionId: x.id });

    expect(result).toEqual({
      ok: true,
      institution: { id: x.id, name: "Green Valley School" },
      competitions: [
        {
          id: open.id,
          code: "OPEN27",
          name: "Open Now",
          slug: open.slug,
          window: "open",
          opensAt: new Date("2027-01-10T03:30:00.000Z"),
          closesAt: new Date("2027-02-10T12:30:00.000Z"),
          registration: { reference: registered.reference },
        },
        {
          id: sooner.id,
          code: "SOON27",
          name: "Opens Soon",
          slug: sooner.slug,
          window: "not_open_yet",
          opensAt: new Date("2027-02-01T03:30:00.000Z"),
          closesAt: new Date("2027-03-01T12:30:00.000Z"),
          registration: null,
        },
        {
          id: later.id,
          code: "LATER27",
          name: "Opens Later",
          slug: later.slug,
          window: "not_open_yet",
          opensAt: new Date("2027-03-01T03:30:00.000Z"),
          closesAt: new Date("2027-04-01T12:30:00.000Z"),
          registration: null,
        },
        {
          id: past.id,
          code: "PAST26",
          name: "Already Closed",
          slug: past.slug,
          window: "closed",
          opensAt: new Date("2026-10-01T03:30:00.000Z"),
          closesAt: new Date("2026-11-01T12:30:00.000Z"),
          registration: null,
        },
      ],
    });
  });

  it("shows registration as closed once the closing instant passes, even before the worker closes it", async () => {
    const h = await createHarness();
    const { institution: x } = await seedInstitution(h);
    const { actor } = await signInCoordinator(h, x.id);
    await h.seed.competition({
      status: "registration_open",
      participation: "institutions",
      keyDates: {
        registration_opens: "2027-01-10T09:00",
        registration_closes: "2027-02-10T18:00",
        submissions_close: "2027-02-20T18:00",
        school_round_closes: "2027-03-01T18:00",
      },
    });

    h.clock.set(new Date("2027-02-10T12:30:00.000Z"));
    const result = await h
      .as(actor)
      .listCompetitionsForInstitution({ institutionId: x.id });

    expect(result.ok && result.competitions.map((each) => each.window)).toEqual(
      ["closed"]
    );
  });

  it.each(["pending_verification", "rejected", "suspended"] as const)(
    "lists nothing for an institution that is %s",
    async (status) => {
      const h = await createHarness();
      const { institution: x } = await seedInstitution(h, { status });
      const { actor } = await signInCoordinator(h, x.id);

      const result = await h
        .as(actor)
        .listCompetitionsForInstitution({ institutionId: x.id });

      expect(result).toEqual({ ok: false, error: "institution_not_verified" });
    }
  );

  describe("who may list", () => {
    it("lets the institution's authorised person list", async () => {
      const h = await createHarness();
      const { institution: x, admin } = await seedInstitution(h);

      const result = await h
        .as(await h.signIn(admin))
        .listCompetitionsForInstitution({ institutionId: x.id });

      expect(result).toMatchObject({ ok: true });
    });

    const OUTSIDERS: [string, (h: Harness) => Promise<Actor>][] = [
      [
        "a coordinator of another institution",
        async (h) => {
          const { institution: y } = await seedInstitution(h, { name: "Y" });
          return (await signInCoordinator(h, y.id)).actor;
        },
      ],
      ["a member", async (h) => h.signIn(await h.seed.member())],
      ["a staff admin", (h) => signedInStaff(h)],
      ["a visitor", async (h) => h.visitor()],
    ];

    it.each(OUTSIDERS)("refuses %s", async (_who, actorFor) => {
      const h = await createHarness();
      const { institution: x } = await seedInstitution(h, { name: "X" });
      const actor = await actorFor(h);

      await expect(
        h.as(actor).listCompetitionsForInstitution({ institutionId: x.id })
      ).rejects.toThrow(DomainError);
    });
  });
});
