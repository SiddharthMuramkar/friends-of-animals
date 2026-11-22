// The staff second factor (#60) in front of the competitions module. A
// competition manager is staff, so every admin use case waits until they
// have set up a second factor and passed it in this session; a refusal
// writes nothing. Reading published competitions stays open to anyone.

import { count, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import type { Actor } from "@/server/actor";
import { auditLog, competition } from "@/server/db/schema";
import { createHarness, type Harness } from "@/test/harness";

import { completeFields, signInManager } from "./testing";

async function setUp() {
  const h = await createHarness();
  const manager = await signInManager(h);
  const created = await h.as(manager).createCompetition(completeFields());
  if (!created.ok) throw new Error(created.error);
  return { h, manager, competitionId: created.competition.id };
}

/** A user holding the global competition manager role. */
async function seedManager(h: Harness) {
  const user = await h.seed.member();
  await h.seed.grant(user, {
    role: "competition_manager",
    scope: { type: "global" },
  });
  return user;
}

/** Every competitions use case that only staff may run, as `actor`. */
function adminUseCases(h: Harness, actor: Actor, competitionId: string) {
  const as = h.as(actor);
  return {
    createCompetition: () =>
      as.createCompetition({ code: "PAWS27", name: "Paws" }),
    listCompetitionsForAdmin: () => as.listCompetitionsForAdmin(),
    getCompetitionForEdit: () => as.getCompetitionForEdit({ competitionId }),
    updateCompetition: () =>
      as.updateCompetition({ competitionId, name: "Renamed" }),
    previewCompetition: () => as.previewCompetition({ competitionId }),
    publishCompetition: () => as.publishCompetition({ competitionId }),
  };
}

async function competitionWrites(h: Harness) {
  const [rows] = await h.db.select({ n: count() }).from(competition);
  const [entries] = await h.db
    .select({ n: count() })
    .from(auditLog)
    .where(eq(auditLog.entityType, "competition"));
  return { competitions: rows?.n, auditEntries: entries?.n };
}

describe("the staff second factor", () => {
  it("refuses a manager who hasn't set one up at every admin use case, writing nothing", async () => {
    const { h, manager, competitionId } = await setUp();
    const unenrolled = await h.signIn(await seedManager(h), undefined, {
      secondFactor: false,
    });
    const before = await competitionWrites(h);
    const draft = await h.as(manager).getCompetitionForEdit({ competitionId });

    for (const [useCase, run] of Object.entries(
      adminUseCases(h, unenrolled, competitionId)
    )) {
      await expect(run(), useCase).rejects.toMatchObject({
        code: "enrolment_required",
      });
    }
    expect(await competitionWrites(h)).toEqual(before);
    expect(
      await h.as(manager).getCompetitionForEdit({ competitionId })
    ).toEqual(draft);
  });

  it("asks an enrolled manager for it again in each new session", async () => {
    const { h, competitionId } = await setUp();
    const user = await seedManager(h);
    const first = await h.signIn(user);
    const second = await h.signIn(user, undefined, { secondFactor: false });
    const before = await competitionWrites(h);

    for (const [useCase, run] of Object.entries(
      adminUseCases(h, second, competitionId)
    )) {
      await expect(run(), useCase).rejects.toMatchObject({
        code: "second_factor_required",
      });
    }
    expect(await competitionWrites(h)).toEqual(before);
    expect(await h.as(first).listCompetitionsForAdmin()).toHaveLength(1);

    // A fresh authenticator code: the first session used this time step's.
    h.clock.advance({ seconds: 30 });
    await h.passSecondFactor(second);
    expect(
      await h.as(second).getCompetitionForEdit({ competitionId })
    ).toMatchObject({ ok: true });
  });

  it("still lets a manager without it read the published competitions", async () => {
    const { h, manager, competitionId } = await setUp();
    expect(
      await h.as(manager).publishCompetition({ competitionId })
    ).toMatchObject({ ok: true });
    const unenrolled = await h.signIn(await seedManager(h), undefined, {
      secondFactor: false,
    });

    expect(await h.as(unenrolled).publishedCompetitionSlugs()).toEqual([
      "neighbours-on-my-street",
    ]);
    expect(
      await h
        .as(unenrolled)
        .getPublishedCompetition({ slug: "neighbours-on-my-street" })
    ).toMatchObject({ id: competitionId, status: "published" });
  });
});
