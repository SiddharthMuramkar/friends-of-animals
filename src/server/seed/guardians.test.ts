import { and, asc, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  guardian,
  guardianLink,
  participantProfile,
  userRole,
} from "@/server/db/schema";
import { createHarness, type Harness } from "@/test/harness";

import { SEED_GUARDIANS } from "./guardians";

async function rows(h: Harness) {
  return {
    guardians: await h.db.select().from(guardian).orderBy(asc(guardian.id)),
    links: await h.db.select().from(guardianLink).orderBy(asc(guardianLink.id)),
    profiles: await h.db
      .select()
      .from(participantProfile)
      .orderBy(asc(participantProfile.id)),
    roles: await h.db.select().from(userRole).orderBy(asc(userRole.id)),
  };
}

describe("the guardians seed", () => {
  it("gives the seeded guardian an under-13 child they manage and a linked teen", async () => {
    const h = await createHarness();
    await h.seed.preview();
    const { guardian: account, teen } = SEED_GUARDIANS;

    const signedIn = await h.signIn(account, undefined, {
      secondFactor: false,
    });
    expect(await h.as(signedIn).myGuardianProfile()).toMatchObject({
      registered: true,
      fullName: account.name,
      verified: true,
    });
    expect(await h.as(signedIn).listChildren()).toEqual([
      expect.objectContaining({
        fullName: SEED_GUARDIANS.children.young.fullName,
        kind: "managed",
        login: "none",
      }),
      expect.objectContaining({
        fullName: SEED_GUARDIANS.children.teen.fullName,
        kind: "linked",
        login: "linked",
      }),
    ]);

    const teenActor = await h.signIn(teen, undefined, { secondFactor: false });
    expect(await h.as(teenActor).myGuardians()).toEqual([
      { fullName: account.name, relationship: "parent" },
    ]);
  });

  it("changes nothing when run again", async () => {
    const h = await createHarness();
    await h.seed.preview();
    const first = await rows(h);

    await h.seed.preview();

    expect(await rows(h)).toEqual(first);
  });
});

describe("the guardian builder", () => {
  it("makes a verified guardian with the children asked for", async () => {
    const h = await createHarness();

    const built = await h.seed.guardian({
      name: "Lata Menon",
      children: [
        { fullName: "Riya Menon", age: 7 },
        { fullName: "Dev Menon", age: 14, relationship: "legal_guardian" },
      ],
    });

    const actor = await h.signIn(built.account);
    expect(await h.as(actor).listChildren()).toEqual([
      expect.objectContaining({
        id: built.childIds[0],
        fullName: "Riya Menon",
        age: 7,
        kind: "managed",
        relationship: "parent",
      }),
      expect.objectContaining({
        id: built.childIds[1],
        fullName: "Dev Menon",
        age: 14,
        kind: "linked",
        login: "none",
        relationship: "legal_guardian",
      }),
    ]);
  });

  it("refuses a member who declared as a guardian but never verified, granting nothing", async () => {
    const h = await createHarness();
    const member = await h.seed.member({
      name: "Lata Menon",
      email: "lata@example.test",
    });
    const declared = await h
      .as(await h.signIn(member))
      .registerAsGuardian({ fullName: "Lata Menon", adultDeclared: true });
    expect(declared).toMatchObject({ ok: true });

    await expect(
      h.seed.guardian({
        name: "Lata Menon",
        email: member.email,
        children: [{ fullName: "Riya Menon", age: 7 }],
      })
    ).rejects.toThrow(/not verified/);
    expect(
      await h.db
        .select()
        .from(userRole)
        .where(
          and(eq(userRole.userId, member.id), eq(userRole.role, "guardian"))
        )
    ).toEqual([]);
    expect(await h.db.select().from(participantProfile)).toEqual([]);
  });
});
