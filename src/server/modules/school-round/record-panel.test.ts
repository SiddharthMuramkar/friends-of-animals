import { describe, expect, it } from "vitest";

import { DomainError } from "@/server/errors";
import { globalManager, signedInWith } from "@/server/modules/judging/testing";
import { createHarness } from "@/test/harness";

import { anotherSchool, schoolInJudging } from "./testing";

// #89: the coordinator records who judged the school round: each member's
// full name and designation, 1 to 10 of them. Saving again replaces the
// list.

const PANEL = [
  { fullName: "Lata Kulkarni", designation: "Art teacher" },
  { fullName: "Rohan Dsouza", designation: "Principal" },
];

describe("recordPanel", () => {
  it("records the panel, and saving again replaces it", async () => {
    const h = await createHarness();
    const school = await schoolInJudging(h);
    const coordinator = h.as(school.coordinator.actor);

    expect(
      await coordinator.recordPanel({ ...school.ref, members: PANEL })
    ).toEqual({ ok: true });
    expect(await coordinator.getSchoolRound(school.ref)).toMatchObject({
      round: { panel: PANEL },
    });

    const replaced = [{ fullName: "Meena Joshi", designation: "Artist" }];
    await coordinator.recordPanel({ ...school.ref, members: replaced });
    expect(await coordinator.getSchoolRound(school.ref)).toMatchObject({
      round: { panel: replaced },
    });
  });

  it("trims the names and refuses an empty panel or more than 10 members", async () => {
    const h = await createHarness();
    const school = await schoolInJudging(h);
    const coordinator = h.as(school.coordinator.actor);

    await coordinator.recordPanel({
      ...school.ref,
      members: [{ fullName: "  Lata  Kulkarni ", designation: " Art teacher" }],
    });
    expect(await coordinator.getSchoolRound(school.ref)).toMatchObject({
      round: {
        panel: [{ fullName: "Lata  Kulkarni", designation: "Art teacher" }],
      },
    });
    expect(
      await coordinator.recordPanel({ ...school.ref, members: [] })
    ).toEqual({ ok: false, error: "panel_empty" });
    const eleven = Array.from({ length: 11 }, (_, n) => ({
      fullName: `Judge ${n + 1}`,
      designation: "Teacher",
    }));
    expect(
      await coordinator.recordPanel({ ...school.ref, members: eleven })
    ).toEqual({ ok: false, error: "panel_too_large" });
    expect(await coordinator.getSchoolRound(school.ref)).toMatchObject({
      round: {
        panel: [{ fullName: "Lata  Kulkarni", designation: "Art teacher" }],
      },
    });
  });

  it("refuses a blank or over-long name or designation", async () => {
    const h = await createHarness();
    const school = await schoolInJudging(h);
    const coordinator = h.as(school.coordinator.actor);

    expect(
      await coordinator.recordPanel({
        ...school.ref,
        members: [{ fullName: "   ", designation: "Teacher" }],
      })
    ).toEqual({ ok: false, error: "invalid_input", fields: ["members"] });
    expect(
      await coordinator.recordPanel({
        ...school.ref,
        members: [{ fullName: "Lata", designation: "x".repeat(121) }],
      })
    ).toEqual({ ok: false, error: "invalid_input", fields: ["members"] });
  });

  it("refuses another institution's coordinator, a participant and a competition manager", async () => {
    const h = await createHarness();
    let other: Awaited<ReturnType<typeof anotherSchool>> | undefined;
    const school = await schoolInJudging(h, {
      beforeJudging: async (built) => {
        other = await anotherSchool(h, built.competition.id);
      },
    });
    const participant = await h.signIn(await h.seed.member());
    const manager = await signedInWith(h, globalManager);

    for (const actor of [other!.coordinator.actor, participant, manager]) {
      await expect(
        h.as(actor).recordPanel({ ...school.ref, members: PANEL })
      ).rejects.toThrow(DomainError);
      await expect(h.as(actor).getSchoolRound(school.ref)).rejects.toThrow(
        DomainError
      );
    }
    expect(
      await h.as(school.coordinator.actor).getSchoolRound(school.ref)
    ).toMatchObject({ round: { panel: [] } });
  });
});
