import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { auditLog, guardianLink, participantProfile } from "@/server/db/schema";
import { DomainError } from "@/server/errors";
import { createHarness, type Harness } from "@/test/harness";

import { bornYearsAgo, verifiedGuardian } from "./testing";

const SUNITA = { name: "Sunita Rao", email: "sunita@example.test" };
const VIKRAM = { name: "Vikram Nair", email: "vikram@example.test" };

async function profileRows(h: Harness) {
  return h.db.select().from(participantProfile);
}

describe("addChild and listChildren", () => {
  it("adds a 9-year-old and a 15-year-old, and lists both", async () => {
    const h = await createHarness();
    const { actor } = await verifiedGuardian(h, SUNITA);
    const nine = bornYearsAgo(h, 9, 40);
    const fifteen = bornYearsAgo(h, 15, 100);

    const first = await h.as(actor).addChild({
      fullName: "Meera Rao",
      dateOfBirth: nine,
      relationship: "parent",
    });
    const second = await h.as(actor).addChild({
      fullName: "Arjun Rao",
      dateOfBirth: fifteen,
      relationship: "legal_guardian",
    });

    expect(first).toEqual({
      ok: true,
      childId: expect.any(String),
      kind: "managed",
    });
    expect(second).toEqual({
      ok: true,
      childId: expect.any(String),
      kind: "linked",
    });
    expect(await h.as(actor).listChildren()).toEqual([
      {
        id: first.ok ? first.childId : "",
        fullName: "Meera Rao",
        dateOfBirth: nine,
        age: 9,
        kind: "managed",
        login: "none",
        relationship: "parent",
      },
      {
        id: second.ok ? second.childId : "",
        fullName: "Arjun Rao",
        dateOfBirth: fifteen,
        age: 15,
        kind: "linked",
        login: "none",
        relationship: "legal_guardian",
      },
    ]);
  });

  it("keeps an under-13 on a guardian-owned profile with no login", async () => {
    const h = await createHarness();
    const { account, actor } = await verifiedGuardian(h, SUNITA);

    await h.as(actor).addChild({
      fullName: "Meera Rao",
      dateOfBirth: bornYearsAgo(h, 9),
      relationship: "parent",
    });

    const [profile] = await profileRows(h);
    expect(profile).toMatchObject({
      ownerKind: "guardian",
      ownerUserId: account.id,
      loginUserId: null,
      participantCode: null,
      createdBy: account.id,
    });
    const links = await h.db.select().from(guardianLink);
    expect(links).toEqual([
      expect.objectContaining({
        participantProfileId: profile?.id,
        relationship: "parent",
        revokedAt: null,
      }),
    ]);
  });

  it("refuses an unverified guardian, writing nothing", async () => {
    const h = await createHarness();
    const member = await h.seed.member(SUNITA);
    const actor = await h.signIn(member);
    await h
      .as(actor)
      .registerAsGuardian({ fullName: SUNITA.name, adultDeclared: true });

    const result = await h.as(actor).addChild({
      fullName: "Meera Rao",
      dateOfBirth: bornYearsAgo(h, 9),
      relationship: "parent",
    });

    expect(result).toEqual({ ok: false, error: "guardian_not_verified" });
    expect(await profileRows(h)).toEqual([]);
    expect(await h.db.select().from(guardianLink)).toEqual([]);
  });

  it("asks again for a missing name or an unknown relationship", async () => {
    const h = await createHarness();
    const { actor } = await verifiedGuardian(h, SUNITA);

    expect(
      await h.as(actor).addChild({
        fullName: "  ",
        dateOfBirth: bornYearsAgo(h, 9),
        relationship: "neighbour" as "parent",
      })
    ).toEqual({
      ok: false,
      error: "invalid_input",
      fields: ["fullName", "relationship"],
    });
  });

  it("refuses the same child twice", async () => {
    const h = await createHarness();
    const { actor } = await verifiedGuardian(h, SUNITA);
    const child = {
      fullName: "Meera Rao",
      dateOfBirth: bornYearsAgo(h, 9),
      relationship: "parent" as const,
    };
    await h.as(actor).addChild(child);

    expect(
      await h.as(actor).addChild({ ...child, fullName: " meera  RAO " })
    ).toEqual({ ok: false, error: "already_added" });
    expect(await profileRows(h)).toHaveLength(1);
  });

  it("records who added which child, with no name or date of birth", async () => {
    const h = await createHarness();
    const { account, actor } = await verifiedGuardian(h, SUNITA);
    const added = await h.as(actor).addChild({
      fullName: "Meera Rao",
      dateOfBirth: bornYearsAgo(h, 9),
      relationship: "parent",
    });

    const [entry] = await h.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, "guardian.child_added"));
    expect(entry).toMatchObject({
      actorUserId: account.id,
      actorRole: "guardian",
      entityType: "participant_profile",
      entityId: added.ok ? added.childId : "",
      before: null,
      after: { kind: "managed", relationship: "parent" },
    });
    expect(JSON.stringify(entry)).not.toContain("Meera");
  });

  it("stores the date of birth encrypted, and nothing of the guardian on the profile", async () => {
    const h = await createHarness();
    const { actor } = await verifiedGuardian(h, SUNITA);
    const dateOfBirth = bornYearsAgo(h, 9);
    await h.as(actor).addChild({
      fullName: "Meera Rao",
      dateOfBirth,
      relationship: "parent",
    });

    const raw = JSON.stringify(await profileRows(h));
    expect(raw).not.toContain(dateOfBirth);
    expect(raw).not.toContain("Sunita");
  });
});

describe("a child's age on India's calendar", () => {
  async function kindOf(h: Harness, dateOfBirth: string) {
    const { actor } = await verifiedGuardian(h, SUNITA);
    return h.as(actor).addChild({
      fullName: "Arjun Rao",
      dateOfBirth,
      relationship: "parent",
    });
  }

  it("gives a login from the 13th birthday in India, even while it is still the day before in UTC", async () => {
    // 00:30 on 15 June in India, 19:00 on 14 June in UTC.
    const h = await createHarness({ now: "2026-06-14T19:00:00Z" });
    expect(await kindOf(h, "2013-06-15")).toMatchObject({ kind: "linked" });
  });

  it("keeps a child whose 13th birthday is tomorrow managed", async () => {
    const h = await createHarness({ now: "2026-06-14T19:00:00Z" });
    expect(await kindOf(h, "2013-06-16")).toMatchObject({ kind: "managed" });
  });

  it("counts a 29 February birthday on 1 March in other years", async () => {
    const h = await createHarness({ now: "2025-02-28T06:00:00Z" });
    expect(await kindOf(h, "2012-02-29")).toMatchObject({ kind: "managed" });

    const later = await createHarness({ now: "2025-03-01T06:00:00Z" });
    expect(await kindOf(later, "2012-02-29")).toMatchObject({
      kind: "linked",
    });
  });

  it("refuses an adult, who registers themselves", async () => {
    const h = await createHarness();
    expect(await kindOf(h, bornYearsAgo(h, 18))).toEqual({
      ok: false,
      error: "adult",
    });
  });

  it("refuses a date of birth in the future, or one that doesn't exist", async () => {
    const h = await createHarness();
    const { actor } = await verifiedGuardian(h, SUNITA);
    for (const dateOfBirth of [bornYearsAgo(h, 0, -1), "2019-02-30", "x"]) {
      expect(
        await h.as(actor).addChild({
          fullName: "Arjun Rao",
          dateOfBirth,
          relationship: "parent",
        }),
        dateOfBirth
      ).toEqual({ ok: false, error: "dob_invalid" });
    }
    expect(await profileRows(h)).toEqual([]);
  });

  it("lists a child with the age they are now, and who has since turned 13 as linked", async () => {
    const h = await createHarness();
    const { actor } = await verifiedGuardian(h, SUNITA);
    await h.as(actor).addChild({
      fullName: "Meera Rao",
      dateOfBirth: bornYearsAgo(h, 13, -2),
      relationship: "parent",
    });
    h.clock.advance({ days: 3 });

    expect(await h.as(actor).listChildren()).toMatchObject([
      { age: 13, kind: "linked", login: "none" },
    ]);
  });
});

describe("getChild", () => {
  it("shows the guardian their own child", async () => {
    const h = await createHarness();
    const { actor } = await verifiedGuardian(h, SUNITA);
    const dateOfBirth = bornYearsAgo(h, 9);
    const added = await h.as(actor).addChild({
      fullName: "Meera Rao",
      dateOfBirth,
      relationship: "parent",
    });
    const childId = added.ok ? added.childId : "";

    expect(await h.as(actor).getChild({ childId })).toEqual({
      ok: true,
      child: {
        id: childId,
        fullName: "Meera Rao",
        dateOfBirth,
        age: 9,
        kind: "managed",
        login: "none",
        relationship: "parent",
        invitation: null,
      },
    });
  });
});

describe("who may manage children", () => {
  async function childOfSunita(h: Harness) {
    const sunita = await verifiedGuardian(h, SUNITA);
    const added = await h.as(sunita.actor).addChild({
      fullName: "Meera Rao",
      dateOfBirth: bornYearsAgo(h, 9),
      relationship: "parent",
    });
    if (!added.ok) throw new Error(added.error);
    return { ...sunita, childId: added.childId };
  }

  it("refuses another guardian Sunita's child, and lists them none of hers", async () => {
    const h = await createHarness();
    const { childId } = await childOfSunita(h);
    const vikram = await verifiedGuardian(h, VIKRAM);

    await expect(
      h.as(vikram.actor).getChild({ childId })
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(await h.as(vikram.actor).listChildren()).toEqual([]);
  });

  it("refuses a member who isn't a guardian", async () => {
    const h = await createHarness();
    const { childId } = await childOfSunita(h);
    const member = await h.signIn(await h.seed.member());

    await expect(
      h.as(member).addChild({
        fullName: "Kabir",
        dateOfBirth: bornYearsAgo(h, 9),
        relationship: "parent",
      })
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(h.as(member).listChildren()).rejects.toThrow(DomainError);
    await expect(h.as(member).getChild({ childId })).rejects.toThrow(
      DomainError
    );
  });

  it("refuses visitors", async () => {
    const h = await createHarness();
    const { childId } = await childOfSunita(h);
    const visitor = h.visitor();

    await expect(
      h.as(visitor).addChild({
        fullName: "Kabir",
        dateOfBirth: bornYearsAgo(h, 9),
        relationship: "parent",
      })
    ).rejects.toThrow(DomainError);
    await expect(h.as(visitor).listChildren()).rejects.toThrow(DomainError);
    await expect(h.as(visitor).getChild({ childId })).rejects.toThrow(
      DomainError
    );
  });

  it("refuses a child id that isn't one, as it refuses someone else's", async () => {
    const h = await createHarness();
    const { actor } = await childOfSunita(h);

    await expect(
      h.as(actor).getChild({ childId: "not-an-id" })
    ).rejects.toMatchObject({ code: "forbidden" });
  });
});
