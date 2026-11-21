import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import type { Role } from "@/server/access";
import type { Actor } from "@/server/actor";
import { auditLog } from "@/server/db/schema";
import { createHarness, type Harness } from "@/test/harness";

/** A signed-in user holding `role` globally. */
async function staff(h: Harness, role: Role): Promise<Actor> {
  const account = await h.seed.member();
  await h.seed.grant(account, { role, scope: { type: "global" } });
  return h.signIn(account);
}

/** What staff type in when they learn of a breach. */
function breachDetails(h: Harness, overrides: Record<string, unknown> = {}) {
  return {
    title: "Entry export emailed to the wrong school",
    awareAt: new Date(h.clock.now().getTime() - 2 * 60 * 60 * 1000),
    severity: "high",
    personalDataInvolved: true,
    minorsAffected: true,
    affectedCount: 3,
    impact: "Names and schools of three entrants reached another school.",
    ...overrides,
  } as const;
}

async function breachAudit(h: Harness) {
  return h.db
    .select()
    .from(auditLog)
    .where(eq(auditLog.entityType, "breach"))
    .orderBy(auditLog.id);
}

describe("recordBreach", () => {
  it("records an open breach and audits it without its title or impact", async () => {
    const h = await createHarness();
    const admin = await staff(h, "super_admin");
    const details = breachDetails(h);

    const result = await h.as(admin).recordBreach(details);

    expect(result).toEqual({ ok: true, id: expect.any(String) });
    const id = result.ok ? result.id : "";
    expect(await breachAudit(h)).toEqual([
      expect.objectContaining({
        actorKind: "user",
        actorUserId: admin.kind === "user" ? admin.userId : null,
        actorRole: "super_admin",
        action: "breach.recorded",
        entityType: "breach",
        entityId: id,
        before: null,
        after: {
          status: "open",
          severity: "high",
          personalDataInvolved: true,
          minorsAffected: true,
          affectedCount: 3,
          containedAt: null,
          principalsNotifiedAt: null,
          authorityNotifiedAt: null,
        },
      }),
    ]);
  });
});
