import { describe, expect, it } from "vitest";

import { DomainError } from "@/server/errors";
import { managerOf, signedInWith } from "@/server/modules/judging/testing";
import { createHarness, type Harness } from "@/test/harness";

import {
  anotherSchool,
  categoryOf,
  schoolInJudging,
  type RoundWorld,
} from "./testing";

// #89: each entry's school round outcome, for a student's registration or
// a whole institution registration (M4 #100 reads it). Draft picks stay
// hidden until the round is finalised.

const PANEL = [{ fullName: "Lata Kulkarni", designation: "Art teacher" }];
const WORKER = { kind: "system", process: "worker" } as const;

async function pickAndMaybeFinalise(
  h: Harness,
  school: RoundWorld,
  finalise: boolean
) {
  const coordinator = h.as(school.coordinator.actor);
  await coordinator.recordPanel({ ...school.ref, members: PANEL });
  await coordinator.certifyConduct(school.ref);
  await coordinator.saveShortlist({
    ...school.ref,
    categoryId: await categoryOf(h, school, "photography"),
    picks: [{ entryId: school.entryIds[1]!, position: 2 }],
  });
  if (finalise) {
    await coordinator.finaliseSchoolRound({
      ...school.ref,
      judgingAttested: true,
    });
  }
}

describe("listSchoolRoundOutcomes", () => {
  it("shows every outcome as pending while the round is open", async () => {
    const h = await createHarness();
    const school = await schoolInJudging(h);
    await pickAndMaybeFinalise(h, school, false);

    const result = await h.as(WORKER).listSchoolRoundOutcomes({
      institutionRegistrationId: school.registrationId,
    });

    expect(result).toMatchObject({
      ok: true,
      roundStatus: "open",
      outcomes: [
        { entryId: school.entryIds[1], outcome: "pending", position: null },
        { entryId: school.entryIds[2], outcome: "pending", position: null },
      ],
    });
  });

  it("shows each entry shortlisted with its position, or not shortlisted, once finalised", async () => {
    const h = await createHarness();
    const school = await schoolInJudging(h);
    await pickAndMaybeFinalise(h, school, true);

    expect(
      await h.as(WORKER).listSchoolRoundOutcomes({
        institutionRegistrationId: school.registrationId,
      })
    ).toMatchObject({
      ok: true,
      roundStatus: "finalised",
      outcomes: [
        {
          registrationId: school.registrationIds[0],
          entryId: school.entryIds[1],
          entryCode: expect.stringMatching(/^PAWS27-E-/),
          outcome: "shortlisted",
          position: 2,
        },
        {
          registrationId: school.registrationIds[1],
          entryId: school.entryIds[2],
          outcome: "not_shortlisted",
          position: null,
        },
      ],
    });
    expect(
      await h.as(school.coordinator.actor).listSchoolRoundOutcomes({
        registrationId: school.registrationIds[1]!,
      })
    ).toMatchObject({
      ok: true,
      outcomes: [{ entryId: school.entryIds[2], outcome: "not_shortlisted" }],
    });
  });

  it("lets the platform, the competition's manager and the institution read; refuses another coordinator and a participant", async () => {
    const h = await createHarness();
    let other: Awaited<ReturnType<typeof anotherSchool>> | undefined;
    const school = await schoolInJudging(h, {
      beforeJudging: async (built) => {
        other = await anotherSchool(h, built.competition.id);
      },
    });
    const input = { institutionRegistrationId: school.registrationId };
    const manager = await signedInWith(h, managerOf(school.competition.id));
    const participant = await h.signIn(await h.seed.member());

    for (const actor of [WORKER, manager, school.coordinator.actor]) {
      expect(await h.as(actor).listSchoolRoundOutcomes(input)).toMatchObject({
        ok: true,
      });
    }
    for (const actor of [other!.coordinator.actor, participant]) {
      await expect(h.as(actor).listSchoolRoundOutcomes(input)).rejects.toThrow(
        DomainError
      );
    }
  });
});
