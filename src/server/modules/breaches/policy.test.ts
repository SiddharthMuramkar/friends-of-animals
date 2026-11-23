import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import type { Role } from "@/server/access";
import type { Actor } from "@/server/actor";
import { breachTimelineEvent, outbox } from "@/server/db/schema";
import { createHarness, type Harness } from "@/test/harness";

import {
  breachAudit,
  breachDetails,
  noticeRows,
  recordedBreach,
  staffActor,
} from "./testing";

// #116 AC "Every new use case has authorization tests". The breach log is
// for FOA's administrators: a super admin and a staff admin (G5 default),
// with their second factor. Everyone else is refused before any work, and a
// refusal writes nothing.

type UseCases = ReturnType<Harness["as"]>;

/** Each breach use case, called on `breachId` with valid input. */
const CALLS: Record<
  string,
  (use: UseCases, h: Harness, breachId: string) => Promise<unknown>
> = {
  recordBreach: (use, h) => use.recordBreach(breachDetails(h)),
  updateBreach: (use, _h, breachId) =>
    use.updateBreach({ breachId, severity: "low" }),
  addBreachTimelineEvent: (use, _h, breachId) =>
    use.addBreachTimelineEvent({ breachId, note: "Checked the logs." }),
  containBreach: (use, _h, breachId) => use.containBreach({ breachId }),
  closeBreach: (use, _h, breachId) =>
    use.closeBreach({ breachId, reason: "Nothing left FOA." }),
  notifyAffectedUsers: (use, _h, breachId) =>
    use.notifyAffectedUsers({ breachId, subjects: "all_users" }),
  notifyAuthority: (use, _h, breachId) =>
    use.notifyAuthority({ breachId, manualReference: "DPB/2027/1" }),
  listBreaches: (use) => use.listBreaches(),
  getBreach: (use, _h, breachId) => use.getBreach({ breachId }),
};

const DENIED_ROLES: Role[] = [
  "finance",
  "content_manager",
  "competition_manager",
  "safeguarding_lead",
];

async function deniedActors(h: Harness): Promise<[string, Actor][]> {
  const actors: [string, Actor][] = [];
  for (const role of DENIED_ROLES)
    actors.push([role, await staffActor(h, role)]);
  actors.push(["member", await h.signIn(await h.seed.member())]);
  actors.push(["visitor", h.visitor()]);
  return actors;
}

describe("who may keep the breach log", () => {
  it.each(["super_admin", "staff_admin"] as const)(
    "lets a %s with their second factor run every breach use case",
    async (role) => {
      const h = await createHarness();
      const staff = await staffActor(h, role);
      const owner = await staffActor(h, "super_admin");

      for (const [name, call] of Object.entries(CALLS)) {
        const breachId = await recordedBreach(h, owner);
        if (name === "closeBreach") {
          await expect(
            h.as(owner).containBreach({ breachId })
          ).resolves.toMatchObject({ ok: true });
        }
        await expect(
          call(h.as(staff), h, breachId),
          name
        ).resolves.toMatchObject({ ok: true });
      }
    }
  );

  it("refuses finance, content, competition and safeguarding staff, members and visitors, writing nothing", async () => {
    const h = await createHarness();
    const owner = await staffActor(h, "super_admin");
    const breachId = await recordedBreach(h, owner);
    const audit = await breachAudit(h);

    for (const [who, actor] of await deniedActors(h)) {
      for (const [name, call] of Object.entries(CALLS)) {
        await expect(
          call(h.as(actor), h, breachId),
          `${who} ${name}`
        ).rejects.toMatchObject({ name: "DomainError", code: "forbidden" });
      }
    }

    expect(await breachAudit(h)).toEqual(audit);
    expect(
      await h.db
        .select()
        .from(breachTimelineEvent)
        .where(eq(breachTimelineEvent.breachId, breachId))
    ).toHaveLength(1);
    expect(
      await h.db.select().from(outbox).where(eq(outbox.aggregateType, "breach"))
    ).toEqual([]);
    expect(await noticeRows(h, breachId)).toEqual([]);
  });

  it("asks breach staff for their second factor before anything", async () => {
    const h = await createHarness();
    const account = await h.seed.member();
    await h.seed.grant(account, {
      role: "staff_admin",
      scope: { type: "global" },
    });
    const unverified = await h.signIn(account, undefined, {
      secondFactor: false,
    });

    await expect(
      h.as(unverified).recordBreach(breachDetails(h))
    ).rejects.toMatchObject({ name: "DomainError" });
    expect(await breachAudit(h)).toEqual([]);
  });

  it("asks for a fresh second factor to tell people or close a breach", async () => {
    const h = await createHarness();
    const admin = await staffActor(h, "super_admin");
    const breachId = await recordedBreach(h, admin);
    h.clock.advance({ minutes: 11 });

    for (const call of [
      CALLS.notifyAffectedUsers!,
      CALLS.notifyAuthority!,
      CALLS.closeBreach!,
    ]) {
      await expect(call(h.as(admin), h, breachId)).rejects.toMatchObject({
        name: "DomainError",
        code: "step_up_required",
      });
    }
    await expect(
      h.as(admin).addBreachTimelineEvent({ breachId, note: "Still here." })
    ).resolves.toEqual({ ok: true });
  });
});
