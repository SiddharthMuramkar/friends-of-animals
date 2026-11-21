import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import type { Role } from "@/server/access";
import type { Actor } from "@/server/actor";
import { contactMessage } from "@/server/db/schema";
import { emit } from "@/server/outbox";
import { createHarness, type Harness } from "@/test/harness";
import { solvedHumanCheck } from "@/test/human-check";

const SENDER = "asha.rao@example.test";

const FORM = {
  topic: "SCHOOLS",
  name: "Asha Rao",
  email: SENDER,
  organisation: "Green Valley School",
  subject: "Please call me back at once",
  message: "Click https://spam.example to claim your prize.",
};

async function send(
  h: Harness,
  fields: Record<string, unknown> = {},
  actor: Actor = h.visitor()
) {
  const humanCheck = await solvedHumanCheck(h, actor);
  return h.as(actor).submitContactMessage({ ...FORM, humanCheck, ...fields });
}

async function staff(h: Harness, role: Role, name: string) {
  const user = await h.seed.member({ name });
  await h.seed.grant(user, { role, scope: { type: "global" } });
  return h.signIn(user);
}

describe("the acknowledgement to the sender", () => {
  it("emails the reference and the topic, and nothing the sender wrote", async () => {
    const h = await createHarness();
    const result = await send(h);
    const reference = result.ok ? result.reference : "missing";

    await h.drain();

    const mail = h.email.lastTo(SENDER);
    expect(mail?.subject).toContain(reference);
    expect(mail?.text).toContain(reference);
    expect(mail?.text).toContain("Schools");
    const everything = [mail?.subject, mail?.text, mail?.html].join("\n");
    for (const echoed of [
      FORM.name,
      FORM.organisation,
      FORM.subject,
      FORM.message,
      "spam.example",
    ]) {
      expect(everything).not.toContain(echoed);
    }
  });

  it("goes once, however often the event is delivered", async () => {
    const h = await createHarness();
    const result = await send(h);
    await h.drain();
    const [row] = await h.db
      .select({ id: contactMessage.id })
      .from(contactMessage)
      .where(
        eq(contactMessage.reference, result.ok ? result.reference : "missing")
      );

    // The same event again, as a relay that lost its lease would deliver it.
    await h.db.transaction((tx) =>
      emit(tx, h.clock, {
        type: "contact_message.received",
        aggregate: { type: "contact_message", id: row!.id },
        payload: { messageId: row!.id },
      })
    );
    await h.drain();

    expect(h.email.inbox(SENDER)).toHaveLength(1);
  });

  it("sends nothing for a message the bot screen dropped", async () => {
    const h = await createHarness();

    await send(h, { website: "https://spam.example" });
    await h.drain();

    expect(h.email.sent).toEqual([]);
  });

  it("uses the wording content managers last saved", async () => {
    const h = await createHarness();
    const editor = await staff(h, "content_manager", "Leela Das");
    const template = await h
      .as(editor)
      .getMessageTemplate({ key: "contact.acknowledgement" });
    expect(template.ok).toBe(true);
    const email = template.ok
      ? template.template.channels.find((c) => c.channel === "email")
      : undefined;
    const saved = await h.as(editor).updateMessageTemplate({
      key: "contact.acknowledgement",
      channel: "email",
      subject: "Got it: {{contact.reference}}",
      body: email?.body ?? "",
      version: email?.version,
    });
    expect(saved.ok).toBe(true);

    const result = await send(h);
    await h.drain();

    expect(h.email.lastTo(SENDER)?.subject).toBe(
      `Got it: ${result.ok ? result.reference : "missing"}`
    );
  });
});

describe("the note to the team", () => {
  it("puts one note in each team member's inbox, and none in another team's", async () => {
    const h = await createHarness();
    const manager = await staff(h, "competition_manager", "Meera Iyer");
    const colleague = await staff(h, "competition_manager", "Kiran Bose");
    const treasurer = await staff(h, "finance", "Dev Patel");
    const result = await send(h);
    const reference = result.ok ? result.reference : "missing";

    await h.drain();
    await h.drain();

    for (const member of [manager, colleague]) {
      const inbox = await h.as(member).listInbox();
      expect(inbox).toEqual([
        expect.objectContaining({
          title: expect.stringContaining("Schools"),
          body: expect.stringContaining(reference),
        }),
      ]);
      const words = inbox.map((item) => item.title + item.body).join("\n");
      expect(words).not.toContain(FORM.message);
    }
    expect(await h.as(treasurer).listInbox()).toEqual([]);
  });
});
