import { and, count, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { role } from "@/server/access/domain/policy";
import { grantsOf } from "@/server/access/grants";
import { auditLog, institution, userRole } from "@/server/db/schema";
import { createHarness, type Harness } from "@/test/harness";

import {
  registeredInstitution,
  signedInStaff,
  validRegistration,
} from "./testing";

const INSTITUTION_ID = /^FOA-I-[0-9A-HJKMNP-TV-Z]{5}$/;
const OTHER_INSTITUTION = "01938a00-0000-7000-8000-00000000b002";

async function statusOf(h: Harness, institutionId: string) {
  const [row] = await h.db
    .select({
      status: institution.status,
      statusReason: institution.statusReason,
      institutionCode: institution.institutionCode,
    })
    .from(institution)
    .where(eq(institution.id, institutionId));
  return row;
}

async function decisionEntries(h: Harness, institutionId: string) {
  return h.db
    .select()
    .from(auditLog)
    .where(
      and(
        eq(auditLog.entityType, "institution"),
        eq(auditLog.entityId, institutionId)
      )
    )
    .orderBy(auditLog.id)
    .then((entries) =>
      entries.filter((entry) => entry.action !== "institution.registered")
    );
}

describe("decideInstitution", () => {
  it("verifies an institution: it gets an Institution ID, and its authorised person becomes its admin", async () => {
    const h = await createHarness();
    const { person, actor, institutionId } = await registeredInstitution(h);
    const staff = await signedInStaff(h);
    const decidedAt = h.clock.now();

    const result = await h.as(staff).decideInstitution({
      institutionId,
      decision: "verify",
      reason: "  Checked with the principal by phone. ",
    });

    expect(result).toEqual({
      ok: true,
      outcome: "verified",
      status: "verified",
      institutionCode: expect.stringMatching(INSTITUTION_ID),
    });
    const mine = await h.as(actor).getMyInstitution();
    expect(mine).toMatchObject({
      ok: true,
      institution: {
        status: "verified",
        statusReason: "Checked with the principal by phone.",
        institutionCode: result.ok ? result.institutionCode : "",
        verifiedAt: decidedAt,
      },
    });
    const [row] = await h.db
      .select({ verifiedBy: institution.verifiedBy })
      .from(institution)
      .where(eq(institution.id, institutionId));
    expect(row?.verifiedBy).toBe(staff.kind === "user" ? staff.userId : "");

    // The grant is scoped: a rule for institution admins covers this
    // institution and no other.
    const subject = {
      kind: "user",
      userId: person.id,
      grants: await grantsOf(h.db, person.id),
    } as const;
    const institutionAdmin = role("institution_admin");
    expect(
      institutionAdmin(subject, {
        scopes: [{ type: "institution", id: institutionId }],
      })
    ).toEqual({ allowed: true, role: "institution_admin" });
    expect(
      institutionAdmin(subject, {
        scopes: [{ type: "institution", id: OTHER_INSTITUTION }],
      })
    ).toEqual({ allowed: false });
    expect(subject.grants).toEqual([
      {
        role: "institution_admin",
        scope: { type: "institution", id: institutionId },
      },
    ]);
  });

  it("records exactly one audit entry per decision, with the status and reason only", async () => {
    const h = await createHarness();
    const { person, institutionId } = await registeredInstitution(h);
    const staff = await signedInStaff(h);

    const verified = await h.as(staff).decideInstitution({
      institutionId,
      decision: "verify",
      reason: "Documents match",
    });
    await h.as(staff).decideInstitution({
      institutionId,
      decision: "suspend",
      reason: "Complaint under review",
    });

    const code = verified.ok ? verified.institutionCode : null;
    expect(
      (await decisionEntries(h, institutionId)).map((entry) => ({
        action: entry.action,
        actorRole: entry.actorRole,
        before: entry.before,
        after: entry.after,
      }))
    ).toEqual([
      {
        action: "institution.verified",
        actorRole: "staff_admin",
        before: { status: "pending_verification", reason: null },
        after: {
          status: "verified",
          reason: "Documents match",
          institutionCode: code,
          institutionAdmin: person.id,
        },
      },
      {
        action: "institution.suspended",
        actorRole: "staff_admin",
        before: { status: "verified", reason: "Documents match" },
        after: { status: "suspended", reason: "Complaint under review" },
      },
    ]);
  });

  it("reinstates a suspended institution with the Institution ID it had", async () => {
    const h = await createHarness();
    const { actor, institutionId } = await registeredInstitution(h);
    const staff = await signedInStaff(h, "super_admin");
    const decide = (decision: "verify" | "suspend", reason: string) =>
      h.as(staff).decideInstitution({ institutionId, decision, reason });

    const verified = await decide("verify", "Documents match");
    await decide("suspend", "Complaint under review");
    h.clock.advance({ days: 3 });
    const reinstated = await decide("verify", "Complaint resolved");

    const code = verified.ok ? verified.institutionCode : "";
    expect(reinstated).toEqual({
      ok: true,
      outcome: "reinstated",
      status: "verified",
      institutionCode: code,
    });
    expect(await h.as(actor).getMyInstitution()).toMatchObject({
      institution: { status: "verified", institutionCode: code },
    });
  });

  it("gives every verified institution its own Institution ID", async () => {
    const h = await createHarness();
    const staff = await signedInStaff(h);
    const codes = [];
    for (const name of ["First School", "Second School", "Third School"]) {
      const { institutionId } = await registeredInstitution(h, { name });
      const result = await h.as(staff).decideInstitution({
        institutionId,
        decision: "verify",
        reason: "Documents match",
      });
      codes.push(result.ok ? result.institutionCode : null);
    }

    expect(new Set(codes).size).toBe(3);
  });

  it("shows the replacement after a rejection even if the clock moves back", async () => {
    const h = await createHarness();
    const { person, actor, institutionId } = await registeredInstitution(h);
    const staff = await signedInStaff(h);

    expect(
      await h.as(staff).decideInstitution({
        institutionId,
        decision: "reject",
        reason: "Not a registered school",
      })
    ).toEqual({
      ok: true,
      outcome: "rejected",
      status: "rejected",
      institutionCode: null,
    });
    const grants = await h.db
      .select({ n: count() })
      .from(userRole)
      .where(eq(userRole.userId, person.id));
    expect(grants[0]?.n).toBe(0);

    h.clock.set(new Date(h.clock.now().getTime() - 1));
    expect(
      await h
        .as(actor)
        .registerInstitution(validRegistration({ name: "Sunrise School" }))
    ).toMatchObject({ ok: true });
    expect(await h.as(actor).getMyInstitution()).toMatchObject({
      institution: { name: "Sunrise School", status: "pending_verification" },
    });
  });

  it.each([
    ["a blank reason", "reject", "   ", "reason_required"],
    [
      "a reason over 1000 characters",
      "reject",
      "x".repeat(1001),
      "reason_too_long",
    ],
    ["a blank reason to verify", "verify", "", "reason_required"],
  ] as const)(
    "refuses %s and changes nothing",
    async (_case, decision, reason, error) => {
      const h = await createHarness();
      const { institutionId } = await registeredInstitution(h);
      const staff = await signedInStaff(h);

      expect(
        await h.as(staff).decideInstitution({ institutionId, decision, reason })
      ).toEqual({ ok: false, error });
      expect(await statusOf(h, institutionId)).toEqual({
        status: "pending_verification",
        statusReason: null,
        institutionCode: null,
      });
      expect(await decisionEntries(h, institutionId)).toEqual([]);
    }
  );

  it("refuses a move the status table doesn't allow, and changes nothing", async () => {
    const h = await createHarness();
    const { institutionId } = await registeredInstitution(h);
    const staff = await signedInStaff(h);
    await h.as(staff).decideInstitution({
      institutionId,
      decision: "reject",
      reason: "Not a registered school",
    });

    expect(
      await h.as(staff).decideInstitution({
        institutionId,
        decision: "verify",
        reason: "Changed my mind",
      })
    ).toEqual({ ok: false, error: "transition_not_allowed" });
    expect(await statusOf(h, institutionId)).toEqual({
      status: "rejected",
      statusReason: "Not a registered school",
      institutionCode: null,
    });
    expect(await decisionEntries(h, institutionId)).toHaveLength(1);
  });

  it("answers not_found for an institution that doesn't exist", async () => {
    const h = await createHarness();
    const staff = await signedInStaff(h);

    expect(
      await h.as(staff).decideInstitution({
        institutionId: "01938a00-0000-7000-8000-00000000dead",
        decision: "verify",
        reason: "Documents match",
      })
    ).toEqual({ ok: false, error: "not_found" });
  });

  it("refuses a member, and the institution's own admin, and changes nothing", async () => {
    const h = await createHarness();
    const { actor, institutionId } = await registeredInstitution(h);
    const staff = await signedInStaff(h);
    await h.as(staff).decideInstitution({
      institutionId,
      decision: "verify",
      reason: "Documents match",
    });
    const member = await h.signIn(await h.seed.member());

    for (const refused of [member, actor]) {
      await expect(
        h.as(refused).decideInstitution({
          institutionId,
          decision: "suspend",
          reason: "Not allowed",
        })
      ).rejects.toMatchObject({ code: "forbidden" });
    }
    expect(await statusOf(h, institutionId)).toMatchObject({
      status: "verified",
    });
    expect(await decisionEntries(h, institutionId)).toHaveLength(1);
  });
});
