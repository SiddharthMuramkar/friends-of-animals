import { describe, expect, it } from "vitest";

import { createHarness, type Harness } from "@/test/harness";

import { recordAudit } from "./record";
import type { SearchAuditLogResult } from "./search";

const SCHOOL_A = "01938a00-0000-7000-8000-00000000a001";
const COMPETITION = "01938a00-0000-7000-8000-00000000c001";

const coordinatorOfA = {
  role: "institution_coordinator",
  scope: { type: "institution", id: SCHOOL_A },
} as const;
const globalJudge = { role: "judge", scope: { type: "global" } } as const;

/**
 * Two super admins change two members' roles a minute apart, and the
 * worker records a change to a competition:
 *
 *   1. Sunita grants Asha coordinator of school A
 *   2. Sunita grants Ravi judge
 *   3. Vikram revokes Asha's coordinator role
 *   4. the worker opens a competition
 */
async function world(h: Harness) {
  const sunita = await h.seed.superAdmin({ name: "Sunita" });
  const vikram = await h.seed.superAdmin({ name: "Vikram" });
  const asha = await h.seed.member({ name: "Asha" });
  const ravi = await h.seed.member({ name: "Ravi" });
  const asSunita = h.as(await h.signIn(sunita));
  const asVikram = h.as(await h.signIn(vikram));

  await asSunita.grantRole({ userId: asha.id, ...coordinatorOfA });
  h.clock.advance({ minutes: 1 });
  await asSunita.grantRole({ userId: ravi.id, ...globalJudge });
  h.clock.advance({ minutes: 1 });
  await asVikram.revokeRole({ userId: asha.id, ...coordinatorOfA });
  h.clock.advance({ minutes: 1 });
  await recordAudit(
    h.db,
    { clock: h.clock, actor: { kind: "system", process: "worker" } },
    {
      action: "competition.opened",
      entity: { type: "competition", id: COMPETITION },
      before: { status: "scheduled" },
      after: { status: "open" },
      actorRole: null,
    }
  );
  return { sunita, vikram, asha, ravi, asSunita };
}

/** Each entry as "action entity-id", newest first. */
function summary(result: SearchAuditLogResult) {
  if (!result.ok) throw new Error(`search failed: ${result.error}`);
  return result.entries.map((entry) => `${entry.action} ${entry.entity.id}`);
}

describe("searchAuditLog", () => {
  it("lists every entry newest first, with who acted, with which role, and the change", async () => {
    const h = await createHarness();
    const { sunita, asha, ravi, asSunita } = await world(h);

    const result = await asSunita.searchAuditLog({});

    expect(summary(result)).toEqual([
      `competition.opened ${COMPETITION}`,
      `role.revoked ${asha.id}`,
      `role.granted ${ravi.id}`,
      `role.granted ${asha.id}`,
    ]);
    expect(result.ok && result.entries[3]).toEqual({
      id: expect.any(String),
      occurredAt: new Date("2027-01-15T04:30:00.000Z"),
      actor: {
        kind: "user",
        userId: sunita.id,
        name: "Sunita",
        process: null,
        role: "super_admin",
      },
      action: "role.granted",
      entity: { type: "user", id: asha.id },
      before: [],
      after: [coordinatorOfA],
      ip: expect.any(String),
      userAgent: "Seam 1 test",
    });
    expect(result.ok && result.entries[0]?.actor).toEqual({
      kind: "system",
      userId: null,
      name: null,
      process: "worker",
      role: null,
    });
  });

  it("finds a person's entries, as the actor or as the user changed", async () => {
    const h = await createHarness();
    const { vikram, asha, ravi, asSunita } = await world(h);

    expect(summary(await asSunita.searchAuditLog({ person: asha.id }))).toEqual(
      [`role.revoked ${asha.id}`, `role.granted ${asha.id}`]
    );
    expect(
      summary(await asSunita.searchAuditLog({ person: vikram.id }))
    ).toEqual([`role.revoked ${asha.id}`]);
    expect(summary(await asSunita.searchAuditLog({ person: ravi.id }))).toEqual(
      [`role.granted ${ravi.id}`]
    );
  });

  it("filters by entity type, entity and action, alone and together", async () => {
    const h = await createHarness();
    const { asha, ravi, asSunita } = await world(h);

    expect(
      summary(await asSunita.searchAuditLog({ entityType: "competition" }))
    ).toEqual([`competition.opened ${COMPETITION}`]);
    expect(
      summary(
        await asSunita.searchAuditLog({ entityType: "user", entityId: ravi.id })
      )
    ).toEqual([`role.granted ${ravi.id}`]);
    expect(
      summary(await asSunita.searchAuditLog({ action: "role.granted" }))
    ).toEqual([`role.granted ${ravi.id}`, `role.granted ${asha.id}`]);
    expect(
      summary(
        await asSunita.searchAuditLog({
          person: asha.id,
          action: "role.revoked",
        })
      )
    ).toEqual([`role.revoked ${asha.id}`]);
    expect(
      summary(
        await asSunita.searchAuditLog({
          entityType: "competition",
          action: "role.granted",
        })
      )
    ).toEqual([]);
  });

  it("pages newest first by cursor, with no entry twice and none missed", async () => {
    const h = await createHarness();
    const { asha, ravi, asSunita } = await world(h);

    const first = await asSunita.searchAuditLog({ limit: 3 });
    expect(summary(first)).toEqual([
      `competition.opened ${COMPETITION}`,
      `role.revoked ${asha.id}`,
      `role.granted ${ravi.id}`,
    ]);
    const cursor = first.ok ? first.nextCursor : null;
    expect(cursor).toEqual(expect.any(String));

    const second = await asSunita.searchAuditLog({
      limit: 3,
      cursor: cursor ?? undefined,
    });
    expect(summary(second)).toEqual([`role.granted ${asha.id}`]);
    expect(second.ok && second.nextCursor).toBeNull();
  });

  it("gives no next page when the last page is exactly full", async () => {
    const h = await createHarness();
    const { asSunita } = await world(h);

    const result = await asSunita.searchAuditLog({ limit: 4 });

    expect(result.ok && result.entries).toHaveLength(4);
    expect(result.ok && result.nextCursor).toBeNull();
  });

  it("refuses filters it can't use", async () => {
    const h = await createHarness();
    const { asSunita } = await world(h);

    expect(await asSunita.searchAuditLog({ person: "asha", limit: 0 })).toEqual(
      { ok: false, error: "invalid_input", fields: ["person", "limit"] }
    );
    expect(
      await asSunita.searchAuditLog({ entityId: "a-competition" })
    ).toEqual({ ok: false, error: "invalid_input", fields: ["entityId"] });
  });

  it("is for super and staff admins: a member and a visitor are refused", async () => {
    const h = await createHarness();
    await world(h);
    const staffAdmin = await h.seed.member();
    await h.seed.grant(staffAdmin, {
      role: "staff_admin",
      scope: { type: "global" },
    });

    expect(
      await h.as(await h.signIn(staffAdmin)).searchAuditLog({})
    ).toMatchObject({ ok: true, entries: expect.any(Array) });
    for (const actor of [await h.signIn(await h.seed.member()), h.visitor()]) {
      await expect(h.as(actor).searchAuditLog({})).rejects.toMatchObject({
        code: "forbidden",
      });
    }
  });
});
