import { and, asc, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import type { Actor } from "@/server/actor";
import {
  auditLog,
  guardianInvitation,
  participantProfile,
  userRole,
} from "@/server/db/schema";
import { DomainError } from "@/server/errors";
import { createHarness, type Harness } from "@/test/harness";

import { bornYearsAgo, verifiedGuardian } from "./testing";

const SUNITA = { name: "Sunita Rao", email: "sunita@example.test" };
const VIKRAM = { name: "Vikram Nair", email: "vikram@example.test" };
const ARJUN = { name: "Arjun Rao", email: "arjun@example.test" };
const SUBJECT = "Your own login on Friends of Animals";
const INVITATION_LINK =
  /http:\/\/localhost:3000\/invitations\/([A-Za-z0-9_-]{43})(?![A-Za-z0-9_-])/;

/** The token in the newest teen invitation emailed to `to`. */
function tokenSentTo(h: Harness, to: string): string {
  const message = h.email.lastTo(to);
  expect(message?.subject).toBe(SUBJECT);
  const token = INVITATION_LINK.exec(message?.text ?? "")?.[1];
  if (!token) throw new Error(`No invitation link was sent to ${to}`);
  return token;
}

/** Sunita, verified, with a 15-year-old (Arjun) and a 9-year-old (Meera). */
async function family(h: Harness) {
  const sunita = await verifiedGuardian(h, SUNITA);
  const teen = await h.as(sunita.actor).addChild({
    fullName: "Arjun Rao",
    dateOfBirth: bornYearsAgo(h, 15, 30),
    relationship: "parent",
  });
  const young = await h.as(sunita.actor).addChild({
    fullName: "Meera Rao",
    dateOfBirth: bornYearsAgo(h, 9),
    relationship: "parent",
  });
  if (!teen.ok || !young.ok) throw new Error("Could not add the children");
  return {
    ...sunita,
    teenId: teen.childId,
    youngId: young.childId,
  };
}

/** The family, with Arjun invited by email and the message delivered. */
async function invited(h: Harness) {
  const f = await family(h);
  const result = await h
    .as(f.actor)
    .inviteTeenLogin({ childId: f.teenId, email: ARJUN.email });
  if (!result.ok) throw new Error(`Invite failed: ${result.error}`);
  await h.drain();
  return {
    ...f,
    invitationId: result.invitationId,
    token: tokenSentTo(h, ARJUN.email),
  };
}

async function signedIn(h: Harness, details: { name: string; email: string }) {
  return h.signIn(await h.seed.member(details));
}

async function profileOf(h: Harness, id: string) {
  const [row] = await h.db
    .select()
    .from(participantProfile)
    .where(eq(participantProfile.id, id));
  return row;
}

async function invitationRow(h: Harness, id: string) {
  const [row] = await h.db
    .select()
    .from(guardianInvitation)
    .where(eq(guardianInvitation.id, id));
  return row;
}

async function rolesOf(h: Harness, actor: Actor) {
  if (actor.kind !== "user") return [];
  const rows = await h.db
    .select({ role: userRole.role })
    .from(userRole)
    .where(eq(userRole.userId, actor.userId));
  return rows.map((row) => row.role);
}

describe("inviteTeenLogin", () => {
  it("invites a 13- to 17-year-old by email, for 7 days, with one message after the drain", async () => {
    const h = await createHarness();
    const { actor, teenId } = await family(h);
    const sentAt = h.clock.now();

    const result = await h
      .as(actor)
      .inviteTeenLogin({ childId: teenId, email: " Arjun@Example.test " });

    expect(result).toEqual({
      ok: true,
      invitationId: expect.any(String),
      expiresAt: new Date(sentAt.getTime() + 7 * 24 * 60 * 60 * 1000),
    });
    expect(h.email.lastTo(ARJUN.email)).toBeUndefined();
    await h.drain();
    const message = h.email.lastTo(ARJUN.email);
    expect(message?.text).toContain("Hello Arjun Rao");
    expect(message?.text).toContain("Sunita Rao has invited you");
    expect(tokenSentTo(h, ARJUN.email)).toHaveLength(43);
    expect(h.email.sent.filter((sent) => sent.to === ARJUN.email)).toHaveLength(
      1
    );
  });

  it("shows the child as invited, with the address masked", async () => {
    const h = await createHarness();
    const { actor, teenId } = await invited(h);

    expect(await h.as(actor).getChild({ childId: teenId })).toMatchObject({
      ok: true,
      child: {
        login: "invited",
        invitation: {
          sentTo: "a***@example.test",
          status: "pending",
        },
      },
    });
  });

  it("refuses an under-13, who has no login", async () => {
    const h = await createHarness();
    const { actor, youngId } = await family(h);

    expect(
      await h
        .as(actor)
        .inviteTeenLogin({ childId: youngId, email: "meera@example.test" })
    ).toEqual({ ok: false, error: "under_13" });
    expect(await h.db.select().from(guardianInvitation)).toEqual([]);
  });

  it("refuses the guardian's own address: the login must be the child's", async () => {
    const h = await createHarness();
    const { actor, teenId } = await family(h);

    expect(
      await h
        .as(actor)
        .inviteTeenLogin({ childId: teenId, email: SUNITA.email })
    ).toEqual({ ok: false, error: "invitee_is_guardian" });
  });

  it("asks again for something that isn't an email address", async () => {
    const h = await createHarness();
    const { actor, teenId } = await family(h);

    expect(
      await h.as(actor).inviteTeenLogin({ childId: teenId, email: "arjun" })
    ).toEqual({ ok: false, error: "invalid_input", fields: ["email"] });
  });

  it("withdraws the earlier link when inviting again", async () => {
    const h = await createHarness();
    const { actor, teenId, token: first } = await invited(h);

    await h
      .as(actor)
      .inviteTeenLogin({ childId: teenId, email: "arjun.rao@example.test" });
    const teen = await signedIn(h, ARJUN);

    expect(await h.as(teen).acceptTeenInvitation({ token: first })).toEqual({
      ok: false,
      error: "withdrawn",
    });
  });

  it("stores the address encrypted and the token only as a hash", async () => {
    const h = await createHarness();
    const { invitationId, token } = await invited(h);

    const raw = JSON.stringify(await invitationRow(h, invitationId));
    expect(raw).not.toContain("arjun");
    expect(raw).not.toContain(token);
  });
});

describe("acceptTeenInvitation", () => {
  it("links the teen's own login to the profile, as a participant, linked to the guardian", async () => {
    const h = await createHarness();
    const { actor, teenId, token, invitationId } = await invited(h);
    const teen = await signedIn(h, ARJUN);

    const result = await h.as(teen).acceptTeenInvitation({ token });

    expect(result).toEqual({ ok: true, childId: teenId });
    expect(await profileOf(h, teenId)).toMatchObject({
      loginUserId: teen.kind === "user" ? teen.userId : null,
    });
    expect(await invitationRow(h, invitationId)).toMatchObject({
      status: "accepted",
      acceptedAt: h.clock.now(),
      acceptedByUserId: teen.kind === "user" ? teen.userId : null,
      tokenCiphertext: null,
    });
    expect(await rolesOf(h, teen)).toContain("participant");
    expect(await h.as(teen).myGuardians()).toEqual([
      { fullName: "Sunita Rao", relationship: "parent" },
    ]);
    expect(await h.as(actor).listChildren()).toMatchObject([
      { id: teenId, login: "linked" },
      { login: "none" },
    ]);
    const [entry] = await h.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, "guardian.teen_linked"));
    expect(entry).toMatchObject({
      actorUserId: teen.kind === "user" ? teen.userId : null,
      entityType: "participant_profile",
      entityId: teenId,
      before: { loginUserId: null },
    });
  });

  it("refuses a link used once already", async () => {
    const h = await createHarness();
    const { token } = await invited(h);
    const teen = await signedIn(h, ARJUN);
    await h.as(teen).acceptTeenInvitation({ token });

    expect(await h.as(teen).acceptTeenInvitation({ token })).toEqual({
      ok: false,
      error: "already_used",
    });
  });

  it("refuses an expired link, changing nothing", async () => {
    const h = await createHarness();
    const { token, teenId } = await invited(h);
    h.clock.advance({ days: 7 });
    const teen = await signedIn(h, ARJUN);

    expect(await h.as(teen).acceptTeenInvitation({ token })).toEqual({
      ok: false,
      error: "expired",
    });
    expect(await profileOf(h, teenId)).toMatchObject({ loginUserId: null });
    expect(await rolesOf(h, teen)).not.toContain("participant");
  });

  it("refuses a withdrawn link", async () => {
    const h = await createHarness();
    const { actor, token, teenId, invitationId } = await invited(h);

    expect(
      await h.as(actor).withdrawTeenInvitation({ childId: teenId })
    ).toEqual({ ok: true });
    expect(await invitationRow(h, invitationId)).toMatchObject({
      status: "revoked",
      tokenCiphertext: null,
    });
    const teen = await signedIn(h, ARJUN);
    expect(await h.as(teen).acceptTeenInvitation({ token })).toEqual({
      ok: false,
      error: "withdrawn",
    });
    expect(
      await h.as(actor).withdrawTeenInvitation({ childId: teenId })
    ).toEqual({ ok: false, error: "no_pending_invitation" });
  });

  it("refuses someone signed in with another address", async () => {
    const h = await createHarness();
    const { token, teenId } = await invited(h);
    const other = await signedIn(h, {
      name: "Kabir",
      email: "kabir@example.test",
    });

    expect(await h.as(other).acceptTeenInvitation({ token })).toEqual({
      ok: false,
      error: "contact_mismatch",
    });
    expect(await profileOf(h, teenId)).toMatchObject({ loginUserId: null });
  });

  it("refuses the guardian accepting their own invitation", async () => {
    const h = await createHarness();
    const { actor, token } = await invited(h);

    expect(await h.as(actor).acceptTeenInvitation({ token })).toEqual({
      ok: false,
      error: "guardian_cannot_accept",
    });
  });

  it("refuses an account that is already another child's login", async () => {
    const h = await createHarness();
    const { token } = await invited(h);
    // Vikram's teen already accepted with Arjun's address.
    const vikram = await verifiedGuardian(h, VIKRAM);
    const other = await h.as(vikram.actor).addChild({
      fullName: "Dev Nair",
      dateOfBirth: bornYearsAgo(h, 14),
      relationship: "parent",
    });
    if (!other.ok) throw new Error(other.error);
    const teen = await signedIn(h, ARJUN);
    await h
      .as(vikram.actor)
      .inviteTeenLogin({ childId: other.childId, email: ARJUN.email });
    await h.drain();
    expect(
      await h
        .as(teen)
        .acceptTeenInvitation({ token: tokenSentTo(h, ARJUN.email) })
    ).toMatchObject({ ok: true });

    expect(await h.as(teen).acceptTeenInvitation({ token })).toEqual({
      ok: false,
      error: "already_linked",
    });
  });

  it("refuses once the child has turned 18", async () => {
    const h = await createHarness();
    const sunita = await verifiedGuardian(h, SUNITA);
    const added = await h.as(sunita.actor).addChild({
      fullName: "Arjun Rao",
      dateOfBirth: bornYearsAgo(h, 18, -3),
      relationship: "parent",
    });
    if (!added.ok) throw new Error(added.error);
    await h
      .as(sunita.actor)
      .inviteTeenLogin({ childId: added.childId, email: ARJUN.email });
    await h.drain();
    const token = tokenSentTo(h, ARJUN.email);
    h.clock.advance({ days: 4 });
    const teen = await signedIn(h, ARJUN);

    expect(await h.as(teen).acceptTeenInvitation({ token })).toEqual({
      ok: false,
      error: "adult",
    });
  });

  it("says not found for a token that matches nothing", async () => {
    const h = await createHarness();
    const teen = await signedIn(h, ARJUN);

    for (const token of ["x".repeat(43), "too-short"]) {
      expect(await h.as(teen).acceptTeenInvitation({ token })).toEqual({
        ok: false,
        error: "not_found",
      });
    }
  });

  it("is refused to visitors", async () => {
    const h = await createHarness();
    const { token } = await invited(h);
    await expect(
      h.as(h.visitor()).acceptTeenInvitation({ token })
    ).rejects.toThrow(DomainError);
  });
});

describe("viewTeenInvitation", () => {
  it("shows a link holder a masked address, and the guardian's name only to the invited teen", async () => {
    const h = await createHarness();
    const { token } = await invited(h);
    const expiresAt = new Date(h.clock.now().getTime() + 7 * 24 * 3600 * 1000);

    expect(await h.as(h.visitor()).viewTeenInvitation({ token })).toEqual({
      ok: true,
      invitation: {
        status: "pending",
        sentTo: "a***@example.test",
        expiresAt,
        forYou: null,
        guardianName: null,
      },
    });
    const teen = await signedIn(h, ARJUN);
    expect(await h.as(teen).viewTeenInvitation({ token })).toMatchObject({
      invitation: { forYou: true, guardianName: "Sunita Rao" },
    });
    const other = await signedIn(h, {
      name: "Kabir",
      email: "kabir@example.test",
    });
    expect(await h.as(other).viewTeenInvitation({ token })).toMatchObject({
      invitation: { forYou: false, guardianName: null },
    });
  });

  it("reads expired and accepted links as such, and unknown ones as not found", async () => {
    const h = await createHarness();
    const { token } = await invited(h);
    h.clock.advance({ days: 7 });
    expect(await h.as(h.visitor()).viewTeenInvitation({ token })).toMatchObject(
      { invitation: { status: "expired" } }
    );
    expect(
      await h.as(h.visitor()).viewTeenInvitation({ token: "y".repeat(43) })
    ).toEqual({ ok: false, error: "not_found" });
  });
});

describe("myGuardians", () => {
  it("lists nobody for an account that is no child's login", async () => {
    const h = await createHarness();
    const member = await signedIn(h, ARJUN);
    expect(await h.as(member).myGuardians()).toEqual([]);
  });
});

describe("who may invite and withdraw", () => {
  it("refuses another guardian, a linked teen and a visitor", async () => {
    const h = await createHarness();
    const { teenId, youngId, token } = await invited(h);
    const vikram = await verifiedGuardian(h, VIKRAM);
    const teen = await signedIn(h, ARJUN);
    await h.as(teen).acceptTeenInvitation({ token });

    for (const actor of [vikram.actor, teen, h.visitor()]) {
      await expect(
        h
          .as(actor)
          .inviteTeenLogin({ childId: teenId, email: "x@example.test" })
      ).rejects.toMatchObject({ code: "forbidden" });
      await expect(
        h.as(actor).withdrawTeenInvitation({ childId: teenId })
      ).rejects.toMatchObject({ code: "forbidden" });
    }
    // A teen can't add siblings either.
    await expect(
      h.as(teen).addChild({
        fullName: "Kiran Rao",
        dateOfBirth: bornYearsAgo(h, 8),
        relationship: "parent",
      })
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(h.as(teen).getChild({ childId: youngId })).rejects.toThrow(
      DomainError
    );
  });

  it("refuses a linked teen declaring themselves a guardian", async () => {
    const h = await createHarness();
    const { token } = await invited(h);
    const teen = await signedIn(h, ARJUN);
    await h.as(teen).acceptTeenInvitation({ token });

    expect(
      await h
        .as(teen)
        .registerAsGuardian({ fullName: "Arjun Rao", adultDeclared: true })
    ).toEqual({ ok: false, error: "linked_child" });
  });

  it("records the invitation sent and withdrawn, with no address", async () => {
    const h = await createHarness();
    const { actor, teenId } = await invited(h);
    await h.as(actor).withdrawTeenInvitation({ childId: teenId });

    const entries = await h.db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.entityType, "participant_profile"),
          eq(auditLog.entityId, teenId)
        )
      )
      .orderBy(asc(auditLog.id));
    expect(entries.map((entry) => entry.action)).toEqual([
      "guardian.child_added",
      "guardian.teen_invited",
      "guardian.teen_invitation_withdrawn",
    ]);
    expect(JSON.stringify(entries)).not.toContain("arjun@");
  });
});
