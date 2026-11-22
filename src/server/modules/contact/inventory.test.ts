import { eq, getTableColumns, getTableName } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { contactMessage, contactNote } from "@/server/db/schema";
import { createHarness, type Harness } from "@/test/harness";
import { solvedHumanCheck } from "@/test/human-check";

import {
  CONTACT_INVENTORY,
  CONTACT_RETENTION_POLICY,
  contactRetentionCandidates,
} from "./inventory";

const listed = CONTACT_INVENTORY.map(
  (entry) => `${entry.table}.${entry.column}`
);

const columnsOf = (table: typeof contactMessage | typeof contactNote) =>
  Object.values(getTableColumns(table)).map(
    (column) => `${getTableName(table)}.${column.name}`
  );

describe("the contact data inventory", () => {
  it("lists what the sender wrote, their hashed network and staff notes", () => {
    expect(listed).toEqual(
      expect.arrayContaining([
        "contact_message.name",
        "contact_message.email",
        "contact_message.organisation",
        "contact_message.subject",
        "contact_message.message",
        "contact_message.ip_hash",
        "contact_note.body",
      ])
    );
  });

  it("names only columns that exist, once each", () => {
    const columns = new Set([
      ...columnsOf(contactMessage),
      ...columnsOf(contactNote),
    ]);

    expect(listed.filter((column) => !columns.has(column))).toEqual([]);
    expect(new Set(listed).size).toBe(listed.length);
  });

  it("keeps each for 24 months after the message closes, still to confirm", () => {
    for (const entry of CONTACT_INVENTORY) {
      expect(entry.purpose.length, entry.column).toBeGreaterThan(10);
      expect(entry.retention).toMatchObject({
        policy: "contactMessages",
        toConfirm: true,
      });
      expect(entry.retention.period).toMatch(/24 months after/);
    }
    expect(CONTACT_RETENTION_POLICY).toMatchObject({
      key: "contactMessages",
      table: "contact_message",
      action: "delete",
    });
  });
});

describe("which contact messages retention may delete", () => {
  let sends = 0;

  async function receive(h: Harness) {
    sends += 1;
    const visitor = h.visitor({ ip: `192.0.2.${sends}` });
    const result = await h.as(visitor).submitContactMessage({
      topic: "GENERAL",
      name: "Asha Rao",
      email: `sender-${sends}@example.test`,
      subject: "A question",
      message: "Words the sender wrote.",
      humanCheck: await solvedHumanCheck(h, visitor),
    });
    if (!result.ok) throw new Error(`Could not send: ${result.error}`);
    const [row] = await h.db
      .select({ id: contactMessage.id })
      .from(contactMessage)
      .where(eq(contactMessage.reference, result.reference));
    return row!.id;
  }

  it("picks messages 24 months after they closed, never an open or reopened one", async () => {
    const h = await createHarness({ now: "2026-01-10T04:00:00Z" });
    const admin = await h.seed.member({ name: "Ravi Kumar" });
    await h.seed.grant(admin, {
      role: "staff_admin",
      scope: { type: "global" },
    });
    const staff = h.as(await h.signIn(admin));
    const close = (messageId: string) =>
      staff.changeContactMessageStatus({
        messageId,
        status: "closed",
        closeReason: "resolved",
      });
    const resolved = await receive(h);
    const reopened = await receive(h);
    await receive(h); // stays open
    h.clock.set("2026-02-01T10:00:00Z");
    await close(resolved);
    await close(reopened);
    h.clock.advance({ days: 30 });
    await staff.changeContactMessageStatus({
      messageId: reopened,
      status: "in_progress",
    });

    const at = (iso: string) => contactRetentionCandidates(h.db, new Date(iso));

    expect(await at("2028-02-01T09:59:59.999Z")).toEqual([]);
    expect(await at("2028-02-01T10:00:00Z")).toEqual([resolved]);
    // Never the open one, nor the one reopened after it closed.
    expect(await at("2100-01-01T00:00:00Z")).toEqual([resolved]);
  });
});
