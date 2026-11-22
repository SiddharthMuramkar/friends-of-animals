import { and, eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import type { Role } from "@/server/access";
import type { Actor } from "@/server/actor";
import { auditLog, contactMessage, contactNote } from "@/server/db/schema";
import { DomainError } from "@/server/errors";
import { createHarness, type Harness } from "@/test/harness";
import { solvedHumanCheck } from "@/test/human-check";

const GLOBAL = { type: "global" } as const;

let sends = 0;

/** A message from the public form, on `topic`; returns its id. */
async function receive(h: Harness, topic: string, subject = "Hello") {
  sends += 1;
  const visitor = h.visitor({ ip: `192.0.2.${sends % 250}` });
  const humanCheck = await solvedHumanCheck(h, visitor);
  const result = await h.as(visitor).submitContactMessage({
    topic,
    name: "Asha Rao",
    email: `sender-${sends}@example.test`,
    subject,
    message: "Private words from the sender.",
    humanCheck,
  });
  if (!result.ok) throw new Error(`Could not send: ${result.error}`);
  const [row] = await h.db
    .select({ id: contactMessage.id })
    .from(contactMessage)
    .where(eq(contactMessage.reference, result.reference));
  return row!.id;
}

/** A signed-in member of staff holding `role` globally. */
async function staff(h: Harness, role: Role, name: string) {
  const user = await h.seed.member({ name });
  await h.seed.grant(user, { role, scope: GLOBAL });
  return { user, actor: await h.signIn(user) };
}

async function world() {
  const h = await createHarness();
  const schools = await receive(h, "SCHOOLS", "Our school");
  h.clock.advance({ minutes: 1 });
  const donations = await receive(h, "DONATIONS", "My receipt");
  h.clock.advance({ minutes: 1 });
  const general = await receive(h, "GENERAL", "A question");
  const manager = await staff(h, "competition_manager", "Meera Iyer");
  const colleague = await staff(h, "competition_manager", "Kiran Bose");
  const treasurer = await staff(h, "finance", "Dev Patel");
  const admin = await staff(h, "staff_admin", "Ravi Kumar");
  const superAdmin = await staff(h, "super_admin", "Sara Thomas");
  const member = await h.signIn(await h.seed.member({ name: "Nina Roy" }));
  return {
    h,
    ids: { schools, donations, general },
    manager,
    colleague,
    treasurer,
    admin,
    superAdmin,
    member,
  };
}

async function auditFor(h: Harness, messageId: string) {
  return h.db
    .select()
    .from(auditLog)
    .where(
      and(
        eq(auditLog.entityType, "contact_message"),
        eq(auditLog.entityId, messageId)
      )
    );
}

async function rowOf(h: Harness, id: string) {
  const [row] = await h.db
    .select()
    .from(contactMessage)
    .where(eq(contactMessage.id, id));
  return row!;
}

const references = (items: { subject: string }[]) =>
  items.map((item) => item.subject);

describe("listContactInbox", () => {
  it("shows a team member only their team's messages", async () => {
    const { h, manager, treasurer } = await world();

    const forManager = await h.as(manager.actor).listContactInbox({});
    const forTreasurer = await h.as(treasurer.actor).listContactInbox({});

    expect(forManager.ok && references(forManager.items)).toEqual([
      "Our school",
    ]);
    expect(forTreasurer.ok && references(forTreasurer.items)).toEqual([
      "My receipt",
    ]);
  });

  it("shows staff admins and super admins every team, newest first", async () => {
    const { h, admin, superAdmin, ids } = await world();

    for (const { actor } of [admin, superAdmin]) {
      const result = await h.as(actor).listContactInbox({});
      expect(result).toEqual({
        ok: true,
        items: [
          expect.objectContaining({
            id: ids.general,
            subject: "A question",
            topic: "GENERAL",
            team: "staff_admin",
            status: "new",
            name: "Asha Rao",
            reference: expect.stringMatching(/^CM-27-/),
            assignee: null,
          }),
          expect.objectContaining({ id: ids.donations }),
          expect.objectContaining({ id: ids.schools }),
        ],
      });
    }
  });

  it("filters by status, team and assignee", async () => {
    const { h, admin, manager, ids } = await world();
    await h.as(admin.actor).assignContactMessage({
      messageId: ids.schools,
      assigneeId: manager.user.id,
    });

    const inProgress = await h
      .as(admin.actor)
      .listContactInbox({ status: "in_progress" });
    const finance = await h
      .as(admin.actor)
      .listContactInbox({ team: "finance" });
    const mine = await h.as(manager.actor).listContactInbox({ assignee: "me" });
    const unassigned = await h
      .as(admin.actor)
      .listContactInbox({ assignee: "unassigned" });

    expect(inProgress.ok && references(inProgress.items)).toEqual([
      "Our school",
    ]);
    expect(finance.ok && references(finance.items)).toEqual(["My receipt"]);
    expect(mine.ok && mine.items).toEqual([
      expect.objectContaining({
        id: ids.schools,
        assignee: { id: manager.user.id, name: "Meera Iyer" },
      }),
    ]);
    expect(unassigned.ok && references(unassigned.items)).toEqual([
      "A question",
      "My receipt",
    ]);
  });

  it("is for staff on a contact team only", async () => {
    const { h, member } = await world();

    await expect(h.as(member).listContactInbox({})).rejects.toThrow(
      DomainError
    );
    await expect(h.as(h.visitor()).listContactInbox({})).rejects.toThrow(
      DomainError
    );
  });
});

describe("getContactMessage", () => {
  it("shows the team the whole message, its notes and who may take it", async () => {
    const { h, manager, colleague, admin, superAdmin, ids } = await world();

    const result = await h
      .as(manager.actor)
      .getContactMessage({ messageId: ids.schools });

    expect(result).toEqual({
      ok: true,
      message: expect.objectContaining({
        id: ids.schools,
        topic: "SCHOOLS",
        team: "competition_manager",
        name: "Asha Rao",
        email: expect.stringMatching(/@example\.test$/),
        organisation: null,
        subject: "Our school",
        message: "Private words from the sender.",
        status: "new",
        closeReason: null,
        assignee: null,
        closedAt: null,
        notes: [],
      }),
    });
    const assignable = result.ok ? result.message.assignableStaff : [];
    expect(assignable.map((person) => person.id).sort()).toEqual(
      [
        manager.user.id,
        colleague.user.id,
        admin.user.id,
        superAdmin.user.id,
      ].sort()
    );
  });

  it("answers another team's member as if the message weren't there", async () => {
    const { h, treasurer, ids } = await world();

    expect(
      await h.as(treasurer.actor).getContactMessage({ messageId: ids.schools })
    ).toEqual({ ok: false, error: "not_found" });
    expect(
      await h.as(treasurer.actor).getContactMessage({
        messageId: "0194c5a0-0000-7000-8000-00000000dead",
      })
    ).toEqual({ ok: false, error: "not_found" });
    expect(
      await h.as(treasurer.actor).getContactMessage({ messageId: "not-an-id" })
    ).toEqual({ ok: false, error: "not_found" });
  });

  it("is for staff on a contact team only", async () => {
    const { h, member, ids } = await world();

    await expect(
      h.as(member).getContactMessage({ messageId: ids.schools })
    ).rejects.toThrow(DomainError);
  });
});

describe("assignContactMessage", () => {
  it("takes on a new message and records who did what", async () => {
    const { h, manager, colleague, ids } = await world();

    const result = await h.as(manager.actor).assignContactMessage({
      messageId: ids.schools,
      assigneeId: colleague.user.id,
    });

    expect(result).toEqual({ ok: true, changed: true });
    expect(await rowOf(h, ids.schools)).toMatchObject({
      status: "in_progress",
      assignedToUserId: colleague.user.id,
      updatedAt: h.clock.now(),
    });
    expect(await auditFor(h, ids.schools)).toEqual([
      expect.objectContaining({
        action: "contact_message.assigned",
        actorUserId: manager.user.id,
        actorRole: "competition_manager",
        before: { status: "new", assigneeId: null, closeReason: null },
        after: {
          status: "in_progress",
          assigneeId: colleague.user.id,
          closeReason: null,
        },
      }),
    ]);
  });

  it("lets a message be handed back, unassigned, without reopening it", async () => {
    const { h, manager, ids } = await world();
    await h.as(manager.actor).assignContactMessage({
      messageId: ids.schools,
      assigneeId: manager.user.id,
    });

    const result = await h
      .as(manager.actor)
      .assignContactMessage({ messageId: ids.schools, assigneeId: null });

    expect(result).toEqual({ ok: true, changed: true });
    expect(await rowOf(h, ids.schools)).toMatchObject({
      status: "in_progress",
      assignedToUserId: null,
    });
  });

  it("refuses someone who can't handle the message's team", async () => {
    const { h, manager, treasurer, ids } = await world();

    const result = await h.as(manager.actor).assignContactMessage({
      messageId: ids.schools,
      assigneeId: treasurer.user.id,
    });

    expect(result).toEqual({ ok: false, error: "assignee_not_allowed" });
    expect(await rowOf(h, ids.schools)).toMatchObject({
      status: "new",
      assignedToUserId: null,
    });
    expect(await auditFor(h, ids.schools)).toEqual([]);
  });

  it("refuses a closed message until it is reopened", async () => {
    const { h, manager, ids } = await world();
    await h.as(manager.actor).changeContactMessageStatus({
      messageId: ids.schools,
      status: "closed",
      closeReason: "resolved",
    });

    const result = await h.as(manager.actor).assignContactMessage({
      messageId: ids.schools,
      assigneeId: manager.user.id,
    });

    expect(result).toEqual({ ok: false, error: "message_closed" });
    expect(await auditFor(h, ids.schools)).toHaveLength(1);
  });

  it("writes nothing when the assignee doesn't change", async () => {
    const { h, manager, ids } = await world();
    await h.as(manager.actor).assignContactMessage({
      messageId: ids.schools,
      assigneeId: manager.user.id,
    });

    const again = await h.as(manager.actor).assignContactMessage({
      messageId: ids.schools,
      assigneeId: manager.user.id,
    });

    expect(again).toEqual({ ok: true, changed: false });
    expect(await auditFor(h, ids.schools)).toHaveLength(1);
  });

  it("lets staff admins assign on any team, and keeps other teams out", async () => {
    const { h, admin, treasurer, member, ids } = await world();

    expect(
      await h.as(admin.actor).assignContactMessage({
        messageId: ids.donations,
        assigneeId: treasurer.user.id,
      })
    ).toEqual({ ok: true, changed: true });
    expect(
      await h.as(treasurer.actor).assignContactMessage({
        messageId: ids.schools,
        assigneeId: treasurer.user.id,
      })
    ).toEqual({ ok: false, error: "not_found" });
    await expect(
      h.as(member).assignContactMessage({
        messageId: ids.schools,
        assigneeId: null,
      })
    ).rejects.toThrow(DomainError);
  });
});

describe("changeContactMessageStatus", () => {
  it("closes a message with a reason, and records it", async () => {
    const { h, manager, ids } = await world();

    const result = await h.as(manager.actor).changeContactMessageStatus({
      messageId: ids.schools,
      status: "closed",
      closeReason: "spam",
    });

    expect(result).toEqual({ ok: true, changed: true });
    expect(await rowOf(h, ids.schools)).toMatchObject({
      status: "closed",
      closeReason: "spam",
      closedAt: h.clock.now(),
    });
    expect(await auditFor(h, ids.schools)).toEqual([
      expect.objectContaining({
        action: "contact_message.status_changed",
        actorRole: "competition_manager",
        before: { status: "new", assigneeId: null, closeReason: null },
        after: { status: "closed", assigneeId: null, closeReason: "spam" },
      }),
    ]);
  });

  it("reopens a closed message and clears why it was closed", async () => {
    const { h, manager, ids } = await world();
    await h.as(manager.actor).changeContactMessageStatus({
      messageId: ids.schools,
      status: "closed",
      closeReason: "resolved",
    });

    const result = await h.as(manager.actor).changeContactMessageStatus({
      messageId: ids.schools,
      status: "in_progress",
    });

    expect(result).toEqual({ ok: true, changed: true });
    expect(await rowOf(h, ids.schools)).toMatchObject({
      status: "in_progress",
      closeReason: null,
      closedAt: null,
    });
  });

  it("refuses going back to new, and writes nothing", async () => {
    const { h, manager, ids } = await world();
    await h.as(manager.actor).changeContactMessageStatus({
      messageId: ids.schools,
      status: "in_progress",
    });

    const result = await h.as(manager.actor).changeContactMessageStatus({
      messageId: ids.schools,
      status: "new",
    });

    expect(result).toEqual({ ok: false, error: "transition_not_allowed" });
    expect((await rowOf(h, ids.schools)).status).toBe("in_progress");
    expect(await auditFor(h, ids.schools)).toHaveLength(1);
  });

  it("needs a reason to close", async () => {
    const { h, manager, ids } = await world();

    expect(
      await h.as(manager.actor).changeContactMessageStatus({
        messageId: ids.schools,
        status: "closed",
      })
    ).toEqual({ ok: false, error: "close_reason_required" });
    expect(await auditFor(h, ids.schools)).toEqual([]);
  });

  it("writes nothing when the status doesn't change", async () => {
    const { h, manager, ids } = await world();

    expect(
      await h.as(manager.actor).changeContactMessageStatus({
        messageId: ids.schools,
        status: "new",
      })
    ).toEqual({ ok: true, changed: false });
    expect(await auditFor(h, ids.schools)).toEqual([]);
  });

  it("keeps other teams out, and members away", async () => {
    const { h, treasurer, superAdmin, member, ids } = await world();

    expect(
      await h.as(treasurer.actor).changeContactMessageStatus({
        messageId: ids.schools,
        status: "in_progress",
      })
    ).toEqual({ ok: false, error: "not_found" });
    expect(
      await h.as(superAdmin.actor).changeContactMessageStatus({
        messageId: ids.schools,
        status: "in_progress",
      })
    ).toEqual({ ok: true, changed: true });
    await expect(
      h.as(member).changeContactMessageStatus({
        messageId: ids.schools,
        status: "in_progress",
      })
    ).rejects.toThrow(DomainError);
  });
});

describe("addContactNote", () => {
  it("adds a note the team can read, and audits it without its words", async () => {
    const { h, manager, colleague, ids } = await world();

    const result = await h.as(manager.actor).addContactNote({
      messageId: ids.schools,
      body: "  Called the school; they will write again in June.  ",
    });

    expect(result).toEqual({ ok: true, noteId: expect.any(String) });
    const read = await h
      .as(colleague.actor)
      .getContactMessage({ messageId: ids.schools });
    expect(read.ok && read.message.notes).toEqual([
      {
        id: result.ok ? result.noteId : "",
        body: "Called the school; they will write again in June.",
        author: { id: manager.user.id, name: "Meera Iyer" },
        createdAt: h.clock.now(),
      },
    ]);
    const audit = await auditFor(h, ids.schools);
    expect(audit).toEqual([
      expect.objectContaining({
        action: "contact_message.note_added",
        actorRole: "competition_manager",
        before: null,
        after: { noteId: result.ok ? result.noteId : "" },
      }),
    ]);
  });

  it("refuses an empty note", async () => {
    const { h, manager, ids } = await world();

    expect(
      await h
        .as(manager.actor)
        .addContactNote({ messageId: ids.schools, body: "   " })
    ).toEqual({ ok: false, error: "invalid_input" });
    expect(await h.db.$count(contactNote)).toBe(0);
  });

  it("keeps other teams out, and members away", async () => {
    const { h, treasurer, member, ids } = await world();

    expect(
      await h
        .as(treasurer.actor)
        .addContactNote({ messageId: ids.schools, body: "Not mine" })
    ).toEqual({ ok: false, error: "not_found" });
    await expect(
      h.as(member).addContactNote({ messageId: ids.schools, body: "Hi" })
    ).rejects.toThrow(DomainError);
    expect(await h.db.$count(contactNote)).toBe(0);
  });

  it("never lets a note be edited", async () => {
    const { h, manager, ids } = await world();
    await h
      .as(manager.actor)
      .addContactNote({ messageId: ids.schools, body: "First thoughts" });

    await expect(
      h.db.execute(sql`UPDATE contact_note SET body = 'Rewritten'`)
    ).rejects.toThrow();
    const [note] = await h.db.select().from(contactNote);
    expect(note?.body).toBe("First thoughts");
  });
});

describe("the audit log", () => {
  it("never holds what the sender wrote or what staff noted", async () => {
    const { h, manager, ids } = await world();
    const actor: Actor = manager.actor;
    await h.as(actor).assignContactMessage({
      messageId: ids.schools,
      assigneeId: manager.user.id,
    });
    await h
      .as(actor)
      .addContactNote({ messageId: ids.schools, body: "Secret note words" });
    await h.as(actor).changeContactMessageStatus({
      messageId: ids.schools,
      status: "closed",
      closeReason: "resolved",
    });

    const { rows } = await h.db.execute<{ row: string }>(
      sql`SELECT row_to_json(a)::text AS row FROM audit_log a`
    );
    const dump = rows.map((row) => row.row).join("\n");
    expect(dump).not.toContain("Private words");
    expect(dump).not.toContain("Secret note words");
    expect(dump).not.toContain("Our school");
    expect(await auditFor(h, ids.schools)).toHaveLength(3);
  });
});
