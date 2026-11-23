import { describe, expect, it } from "vitest";

import { guardian, guardianLink } from "@/server/db/schema";
import { DomainError } from "@/server/errors";
import { uuidv7 } from "@/server/ids";
import { storedGuardianDetails } from "@/server/modules/guardians/guardian-record";
import type { OpenCompetition } from "@/server/modules/participants/testing";
import { createHarness, type Harness } from "@/test/harness";

import {
  GUARDIAN_PURPOSES,
  type GuardianPurpose,
} from "./domain/guardian-purposes";
import {
  consentCompetition,
  consentRows,
  guardianWithChild,
  publishNextVersion,
  reattach,
} from "./testing";

// #82: a verified guardian gives and withdraws each purpose for their
// child on its own: per competition the child is registered in, and
// communications everywhere. Each change is one consent event against the
// competition's attached version, with the giver, the time and the
// method; a withdrawal emits consent.withdrawn through the outbox.

type World = {
  h: Harness;
  competition: OpenCompetition;
  child: Awaited<ReturnType<typeof guardianWithChild>>;
  communications: { id: string; version: number };
};

async function world(): Promise<World> {
  const h = await createHarness();
  const competition = await consentCompetition(h);
  const communications = await publishNextVersion(h, "communications");
  const child = await guardianWithChild(h, competition);
  return { h, competition, child, communications };
}

/** The version a purpose's consent points at in this world. */
function documentFor(w: World, purpose: GuardianPurpose): string {
  const attached = w.competition.guardianDocuments;
  switch (purpose) {
    case "communications":
      return w.communications.id;
    case "display_school":
    case "display_city":
      return attached.public_display!;
    default:
      return attached[purpose]!;
  }
}

function target(w: World, purpose: GuardianPurpose) {
  return purpose === "communications"
    ? { childId: w.child.childId, purpose }
    : { childId: w.child.childId, competitionId: w.competition.id, purpose };
}

/** Each purpose's status, per competition and for communications. */
async function statuses(w: World) {
  const view = await w.h
    .as(w.child.actor)
    .childConsents({ childId: w.child.childId });
  if (!view.ok) throw new Error(view.error);
  const [competition] = view.competitions;
  return {
    ...Object.fromEntries(
      (competition?.purposes ?? []).map((each) => [
        each.purpose,
        each.state.status,
      ])
    ),
    communications: view.communications.state.status,
  };
}

const NONE_GIVEN = Object.fromEntries(
  GUARDIAN_PURPOSES.map((purpose) => [purpose, "never"])
);

describe("giveChildConsent and withdrawChildConsent", () => {
  it.each(GUARDIAN_PURPOSES)(
    "give and withdraw %s on its own, leaving the other six as they were",
    async (purpose) => {
      const w = await world();
      expect(await statuses(w)).toEqual(NONE_GIVEN);

      expect(
        await w.h.as(w.child.actor).giveChildConsent({
          ...target(w, purpose),
          documentId: documentFor(w, purpose),
        })
      ).toEqual({ ok: true, changed: true });
      expect(await statuses(w)).toEqual({ ...NONE_GIVEN, [purpose]: "given" });

      w.h.clock.advance({ minutes: 1 });
      expect(
        await w.h.as(w.child.actor).withdrawChildConsent(target(w, purpose))
      ).toEqual({ ok: true, changed: true });
      expect(await statuses(w)).toEqual({
        ...NONE_GIVEN,
        [purpose]: "withdrawn",
      });
    }
  );

  it("changes nothing, writing no row, for giving again on the same version or withdrawing what was never given", async () => {
    const w = await world();
    const give = {
      ...target(w, "public_display"),
      documentId: documentFor(w, "public_display"),
    };
    await w.h.as(w.child.actor).giveChildConsent(give);
    const before = await consentRows(w.h);

    expect(await w.h.as(w.child.actor).giveChildConsent(give)).toEqual({
      ok: true,
      changed: false,
    });
    expect(
      await w.h.as(w.child.actor).withdrawChildConsent(target(w, "auction"))
    ).toEqual({ ok: true, changed: false });
    expect(await consentRows(w.h)).toEqual(before);
  });

  it("records a new event for giving again after a withdrawal", async () => {
    const w = await world();
    const give = {
      ...target(w, "social_media"),
      documentId: documentFor(w, "social_media"),
    };
    await w.h.as(w.child.actor).giveChildConsent(give);
    w.h.clock.advance({ minutes: 1 });
    await w.h.as(w.child.actor).withdrawChildConsent(target(w, "social_media"));
    w.h.clock.advance({ minutes: 1 });

    expect(await w.h.as(w.child.actor).giveChildConsent(give)).toEqual({
      ok: true,
      changed: true,
    });
    const { events } = await consentRows(w.h);
    expect(events.map((event) => event.action)).toEqual([
      "given",
      "withdrawn",
      "given",
    ]);
  });
});

describe("a guardian's consent record", () => {
  it("names the child, the guardian, the competition, its attached version, the method and the time", async () => {
    const w = await world();
    // Staff publish version 2; the competition still has version 1 attached.
    const v2 = await publishNextVersion(w.h, "public_display");
    const at = w.h.clock.now();

    expect(
      await w.h.as(w.child.actor).giveChildConsent({
        ...target(w, "display_city"),
        documentId: v2.id,
      })
    ).toEqual({ ok: false, error: "document_outdated" });
    await w.h.as(w.child.actor).giveChildConsent({
      ...target(w, "display_city"),
      documentId: documentFor(w, "display_city"),
    });

    const { events } = await consentRows(w.h);
    expect(events).toEqual([
      {
        id: expect.any(String),
        subjectType: "participant_profile",
        subjectId: w.child.childId,
        giverUserId: w.child.userId,
        purpose: "display_city",
        competitionId: w.competition.id,
        documentId: w.competition.guardianDocuments.public_display,
        action: "given",
        method: "web_form",
        occurredAt: at,
      },
    ]);
  });

  it("points at the new version once a manager re-attaches it", async () => {
    const w = await world();
    const v2 = await publishNextVersion(w.h, "participation");
    await reattach(w.h, w.competition.id, "participation", v2.id);

    expect(
      await w.h.as(w.child.actor).giveChildConsent({
        ...target(w, "participation"),
        documentId: v2.id,
      })
    ).toEqual({ ok: true, changed: true });
    expect((await consentRows(w.h)).events[0]?.documentId).toBe(v2.id);
  });

  it("gives communications for no competition, on the current published version", async () => {
    const w = await world();
    const v2 = await publishNextVersion(w.h, "communications");

    expect(
      await w.h.as(w.child.actor).giveChildConsent({
        ...target(w, "communications"),
        documentId: w.communications.id,
      })
    ).toEqual({ ok: false, error: "document_outdated" });
    await w.h.as(w.child.actor).giveChildConsent({
      ...target(w, "communications"),
      documentId: v2.id,
    });

    const [event] = (await consentRows(w.h)).events;
    expect(event).toMatchObject({
      purpose: "communications",
      competitionId: null,
      documentId: v2.id,
      subjectId: w.child.childId,
    });
  });
});

describe("withdrawing a child's consent", () => {
  it("emits one consent.withdrawn with ids only in the same transaction, which the drain dispatches; giving emits none", async () => {
    const w = await world();
    await w.h.as(w.child.actor).giveChildConsent({
      ...target(w, "public_display"),
      documentId: documentFor(w, "public_display"),
    });
    expect((await consentRows(w.h)).outbox).toEqual([]);

    await w.h
      .as(w.child.actor)
      .withdrawChildConsent(target(w, "public_display"));

    const { outbox, events } = await consentRows(w.h);
    const withdrawal = events.find((event) => event.action === "withdrawn");
    expect(outbox).toMatchObject([
      {
        eventType: "consent.withdrawn",
        aggregateType: "consent_event",
        aggregateId: withdrawal?.id,
        status: "pending",
      },
    ]);
    expect(outbox[0]?.payload).toEqual({
      consentEventId: withdrawal?.id,
      subjectType: "participant_profile",
      subjectId: w.child.childId,
      purpose: "public_display",
      documentId: w.competition.guardianDocuments.public_display,
      competitionId: w.competition.id,
    });
    await w.h.drain();
    expect((await consentRows(w.h)).outbox.map((row) => row.status)).toEqual([
      "dispatched",
    ]);
  });

  it("is audited per change, as the guardian", async () => {
    const w = await world();
    await w.h.as(w.child.actor).giveChildConsent({
      ...target(w, "auction"),
      documentId: documentFor(w, "auction"),
    });
    await w.h.as(w.child.actor).withdrawChildConsent(target(w, "auction"));

    const { audit, events } = await consentRows(w.h);
    expect(audit).toMatchObject([
      {
        action: "consent.given",
        actorUserId: w.child.userId,
        actorRole: "guardian",
        entityId: events[0]?.id,
      },
      {
        action: "consent.withdrawn",
        actorUserId: w.child.userId,
        actorRole: "guardian",
        entityId: events[1]?.id,
      },
    ]);
  });
});

describe("what a competition offers", () => {
  it("refuses the public purposes when the competition doesn't allow public display, and auction when it doesn't allow auction", async () => {
    const h = await createHarness();
    const competition = await consentCompetition(h, {
      publicDisplay: false,
      auctionPermitted: false,
    });
    const child = await guardianWithChild(h, competition);
    const attached = competition.guardianDocuments;

    for (const [purpose, documentId] of [
      ["public_display", attached.public_display],
      ["display_school", attached.public_display],
      ["display_city", attached.public_display],
      ["social_media", attached.social_media],
      ["auction", attached.auction],
    ] as const) {
      expect(
        await h.as(child.actor).giveChildConsent({
          childId: child.childId,
          competitionId: competition.id,
          purpose,
          documentId: documentId!,
        })
      ).toEqual({ ok: false, error: "purpose_not_offered" });
    }
    expect((await consentRows(h)).events).toEqual([]);
  });

  it("refuses a purpose whose document isn't attached", async () => {
    const h = await createHarness();
    const competition = await consentCompetition(h, {
      guardianDocuments: ["participation"],
    });
    const child = await guardianWithChild(h, competition);
    const unattached = await publishNextVersion(h, "public_display");

    expect(
      await h.as(child.actor).giveChildConsent({
        childId: child.childId,
        competitionId: competition.id,
        purpose: "public_display",
        documentId: unattached.id,
      })
    ).toEqual({ ok: false, error: "purpose_not_offered" });
  });

  it("asks for a competition for a competition purpose, and refuses one for communications", async () => {
    const w = await world();

    expect(
      await w.h.as(w.child.actor).giveChildConsent({
        childId: w.child.childId,
        purpose: "participation",
        documentId: documentFor(w, "participation"),
      })
    ).toEqual({ ok: false, error: "competition_required" });
    expect(
      await w.h.as(w.child.actor).withdrawChildConsent({
        childId: w.child.childId,
        purpose: "participation",
      })
    ).toEqual({ ok: false, error: "competition_required" });
    expect(
      await w.h.as(w.child.actor).giveChildConsent({
        childId: w.child.childId,
        competitionId: w.competition.id,
        purpose: "communications",
        documentId: w.communications.id,
      })
    ).toEqual({ ok: false, error: "competition_not_allowed" });
  });

  it("refuses a competition the child isn't registered in", async () => {
    const w = await world();
    const other = await consentCompetition(w.h);

    expect(
      await w.h.as(w.child.actor).giveChildConsent({
        childId: w.child.childId,
        competitionId: other.id,
        purpose: "participation",
        documentId: other.guardianDocuments.participation!,
      })
    ).toEqual({ ok: false, error: "not_registered" });
  });

  it("asks again for input that can't be a consent", async () => {
    const w = await world();

    expect(
      await w.h.as(w.child.actor).giveChildConsent({
        childId: w.child.childId,
        competitionId: w.competition.id,
        purpose: "privacy_notice" as GuardianPurpose,
        documentId: "not-a-uuid",
      })
    ).toMatchObject({ ok: false, error: "invalid_input" });
  });
});

describe("who may give, withdraw and read a child's consents", () => {
  async function refusedEverything(
    w: World,
    actor: Parameters<Harness["as"]>[0]
  ) {
    const give = {
      ...target(w, "participation"),
      documentId: documentFor(w, "participation"),
    };
    await expect(w.h.as(actor).giveChildConsent(give)).rejects.toThrow(
      DomainError
    );
    await expect(
      w.h.as(actor).withdrawChildConsent(target(w, "participation"))
    ).rejects.toThrow(DomainError);
    await expect(
      w.h.as(actor).childConsents({ childId: w.child.childId })
    ).rejects.toThrow(DomainError);
    await expect(
      w.h.as(actor).childConsentHistory({ childId: w.child.childId })
    ).rejects.toThrow(DomainError);
  }

  it("refuses another guardian, writing nothing", async () => {
    const w = await world();
    const { account } = await w.h.seed.guardian({
      children: [{ fullName: "Other Child", age: 10 }],
    });

    await refusedEverything(w, await w.h.signIn(account));
    expect((await consentRows(w.h)).events).toEqual([]);
  });

  it("refuses a plain member and a visitor", async () => {
    const w = await world();

    await refusedEverything(w, await w.h.signIn(await w.h.seed.member()));
    await refusedEverything(w, w.h.visitor());
    expect((await consentRows(w.h)).events).toEqual([]);
  });

  it("refuses the teen themselves: a child can't give their guardian's consent", async () => {
    const h = await createHarness();
    const competition = await consentCompetition(h);
    const teen = await h.seed.member({ name: "Rohan Desai" });
    const child = await guardianWithChild(h, competition, {
      fullName: "Rohan Desai",
      age: 15,
      loginUserId: teen.id,
    });
    const w: World = {
      h,
      competition,
      child,
      communications: await publishNextVersion(h, "communications"),
    };

    await refusedEverything(w, await h.signIn(teen));
    expect((await consentRows(h)).events).toEqual([]);
  });

  it("tells a guardian who hasn't verified so, writing nothing", async () => {
    const w = await world();
    const member = await w.h.seed.member({ name: "Unverified Parent" });
    const now = w.h.clock.now();
    const guardianId = uuidv7(now);
    await w.h.db.insert(guardian).values({
      id: guardianId,
      userId: member.id,
      ...storedGuardianDetails(w.h.deps, {
        fullName: "Unverified Parent",
        phone: null,
      }),
      adultDeclaredAt: now,
      createdAt: now,
      updatedAt: now,
    });
    await w.h.db.insert(guardianLink).values({
      id: uuidv7(now),
      guardianId,
      participantProfileId: w.child.childId,
      relationship: "parent",
      createdAt: now,
    });
    const actor = await w.h.signIn(member);

    expect(
      await w.h.as(actor).giveChildConsent({
        ...target(w, "participation"),
        documentId: documentFor(w, "participation"),
      })
    ).toEqual({ ok: false, error: "guardian_not_verified" });
    expect(
      await w.h.as(actor).withdrawChildConsent(target(w, "participation"))
    ).toEqual({ ok: false, error: "guardian_not_verified" });
    expect(
      await w.h.as(actor).childConsents({ childId: w.child.childId })
    ).toEqual({ ok: false, error: "guardian_not_verified" });
    expect((await consentRows(w.h)).events).toEqual([]);
  });
});
