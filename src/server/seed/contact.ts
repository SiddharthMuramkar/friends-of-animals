// Contact inbox seed data (#113): four messages from the contact form, so
// a preview shows the staff inbox at work. One is new, one is assigned to
// the seeded content manager with a note of hers, and two are closed, one
// as spam and one resolved, across three teams. Seed data, not staff
// actions: it writes no audit entries and sends nothing. Loads under plain
// Node (the seed script): relative imports only, no "server-only".

import { eq } from "drizzle-orm";

import { contactMessage, contactNote, user } from "../db/schema";
import { contactReferenceFormat } from "../modules/contact/domain/submission";
import { normaliseEmailAddress } from "../ports/email";
import { SEED_ACCOUNTS } from "./accounts";
import type { SeedDeps } from "./types";

const HOUR = 60 * 60 * 1000;

/** Fixed ids, so seeding again adds nothing and keeps what staff changed. */
const id = (n: number) => `01938a00-0000-7000-8113-00000000000${n}`;

export const SEED_CONTACT_MESSAGE_IDS = {
  new: id(1),
  inProgress: id(2),
  spam: id(3),
  resolved: id(4),
} as const;

const NOTE_ID = "01938a00-0000-7000-8113-000000000011";

export async function seedContact({ db, clock, blindIndex }: SeedDeps) {
  const now = clock.now();
  const ago = (hours: number) => new Date(now.getTime() - hours * HOUR);
  // By address: someone may have signed up with it before the seed ran.
  const [editor] = await db
    .select({ id: user.id })
    .from(user)
    .where(
      eq(user.email, normaliseEmailAddress(SEED_ACCOUNTS.members[0].email))
    );
  if (!editor) throw new Error("The seeded content manager is missing");
  // Documentation addresses only (RFC 5737), hashed as the form hashes them.
  const ipHash = blindIndex.of("contact_message.ip_hash", "203.0.113.0/24");
  const reference = (at: Date, symbols: string) =>
    contactReferenceFormat(at).prefix + symbols;
  const received = (hours: number, symbols: string) => {
    const createdAt = ago(hours);
    return {
      reference: reference(createdAt, symbols),
      ipHash,
      createdAt,
      acknowledgedAt: createdAt,
    };
  };

  await db
    .insert(contactMessage)
    .values([
      {
        id: SEED_CONTACT_MESSAGE_IDS.new,
        ...received(2, "SEED01"),
        topic: "SCHOOLS",
        team: "competition_manager",
        name: "Kavya Menon",
        email: "kavya.menon@example.test",
        organisation: "Green Valley School",
        subject: "Registering our school for the art competition",
        message:
          "Our students would like to take part in this year's art competition. How do we register the school, and is there a fee?",
        updatedAt: ago(2),
      },
      {
        id: SEED_CONTACT_MESSAGE_IDS.inProgress,
        ...received(26, "SEED02"),
        topic: "MEDIA",
        team: "content_manager",
        name: "Arjun Nair",
        email: "arjun.nair@example.test",
        organisation: "The Coastal Herald",
        subject: "Interview for a feature on caring for street dogs",
        message:
          "I'm writing a feature on how neighbourhoods care for street dogs and would like to interview someone from Friends of Animals this week.",
        status: "in_progress",
        assignedToUserId: editor.id,
        updatedAt: ago(20),
      },
      {
        id: SEED_CONTACT_MESSAGE_IDS.spam,
        ...received(48, "SEED03"),
        topic: "GENERAL",
        team: "staff_admin",
        name: "Prize Desk",
        email: "prize.desk@example.test",
        subject: "You have won a prize",
        message: "Reply with your bank details to claim your prize today.",
        status: "closed",
        closeReason: "spam",
        closedAt: ago(40),
        updatedAt: ago(40),
      },
      {
        id: SEED_CONTACT_MESSAGE_IDS.resolved,
        ...received(96, "SEED04"),
        topic: "SCHOOLS",
        team: "competition_manager",
        name: "Farah Sheikh",
        email: "farah.sheikh@example.test",
        organisation: "Riverside Public School",
        subject: "A copy of last year's certificate",
        message:
          "One of our students lost the certificate she won last year. Could you send the school a copy?",
        status: "closed",
        closeReason: "resolved",
        closedAt: ago(72),
        updatedAt: ago(72),
      },
    ])
    .onConflictDoNothing({ target: contactMessage.id });

  await db
    .insert(contactNote)
    .values({
      id: NOTE_ID,
      messageId: SEED_CONTACT_MESSAGE_IDS.inProgress,
      authorUserId: editor.id,
      body: "Called Arjun back. The interview is on Thursday at 11; I'll send him our facts sheet before then.",
      createdAt: ago(20),
    })
    .onConflictDoNothing({ target: contactNote.id });
}
