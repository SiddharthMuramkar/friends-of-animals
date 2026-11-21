// Who an announcement reaches (#84 owner decision, 2026-11-19): individual
// participants (their guardian if under 18), the coordinators of every
// confirmed institution registration, and the guardians of every enrolled
// student (or the student, if an adult). Each person gets one copy, however
// many registrations lead to them.
//
// Pure: the use case loads an `AudienceSnapshot` (decrypted contacts, rows
// ordered by id so a retried fan-out plans the same keys) and passes the
// send instant from the clock.

import { isUnder18On, type IsoDate } from "./age";

/** Someone with an account: the inbox plus their channel preferences. */
export type AccountContact = {
  kind: "account";
  userId: string;
  email: string | null;
  phone?: string | null;
};

/**
 * Contact details with no account behind them, such as the guardian on a
 * school-managed profile. They can be reached by email and SMS only.
 */
export type DetailsContact = {
  kind: "details";
  name: string | null;
  email: string | null;
  phone: string | null;
};

export type Contact = AccountContact | DetailsContact;

export type Participant = {
  participantProfileId: string;
  /** `null` when unknown: treated as a minor. */
  dateOfBirth: IsoDate | null;
  /** Their own login or contact details; `null` for an under-13 profile. */
  self: Contact | null;
  /** Active guardian links, or the guardian on a school-managed profile. */
  guardians: readonly Contact[];
};

export type AudienceSnapshot = {
  individualRegistrations: readonly {
    registrationId: string;
    confirmed: boolean;
    participant: Participant;
  }[];
  institutionRegistrations: readonly {
    institutionRegistrationId: string;
    confirmed: boolean;
    coordinators: readonly AccountContact[];
    students: readonly {
      registrationId: string;
      /** False once withdrawn or refunded. */
      enrolled: boolean;
      participant: Participant;
    }[];
  }[];
};

export type RecipientRole = "participant" | "guardian" | "coordinator";

export type Recipient = {
  /**
   * One person, stable across retries: `user:<id>`, else `email:<address>`,
   * else `phone:<number>`. Contains personal data: store a keyed hash of it,
   * never the key itself.
   */
  key: string;
  contact: Contact;
  /** Every reason this person is on the list, in the order first found. */
  roles: RecipientRole[];
};

export type Unreachable = {
  participantProfileId: string;
  reason: "minor_without_guardian" | "no_contact";
};

export type AudiencePlan = {
  recipients: Recipient[];
  /** Participants nobody could be found for. A minor is never the fallback. */
  unreachable: Unreachable[];
  counts: {
    recipients: number;
    participants: number;
    guardians: number;
    coordinators: number;
    unreachable: number;
  };
};

const normaliseEmail = (email: string) => email.trim().toLowerCase();
const normalisePhone = (phone: string) => phone.replace(/\s+/g, "");

function present(
  value: string | null | undefined,
  clean: (v: string) => string
) {
  if (value === null || value === undefined) return null;
  const cleaned = clean(value);
  return cleaned === "" ? null : cleaned;
}

function reachable(contact: Contact): boolean {
  return (
    contact.kind === "account" ||
    present(contact.email, normaliseEmail) !== null ||
    present(contact.phone, normalisePhone) !== null
  );
}

/**
 * Collects recipients so that one person appears once: an account by user
 * id, contact details by email or phone, and contact details that match an
 * account's email or phone fold into that account (which also gets the
 * inbox copy).
 */
class RecipientList {
  readonly #entries: Recipient[] = [];
  readonly #byUser = new Map<string, Recipient>();
  readonly #byEmail = new Map<string, Recipient>();
  readonly #byPhone = new Map<string, Recipient>();

  add(contact: Contact, role: RecipientRole): void {
    const email = present(contact.email, normaliseEmail);
    const phone = present(contact.phone, normalisePhone);
    const existing =
      (contact.kind === "account"
        ? this.#byUser.get(contact.userId)
        : undefined) ??
      (email === null ? undefined : this.#byEmail.get(email)) ??
      (phone === null ? undefined : this.#byPhone.get(phone));

    const shareable =
      existing &&
      (contact.kind === "details" ||
        existing.contact.kind === "details" ||
        (existing.contact.kind === "account" &&
          existing.contact.userId === contact.userId));

    if (existing && shareable) {
      this.#merge(existing, contact, email, phone);
      if (!existing.roles.includes(role)) existing.roles.push(role);
      return;
    }

    const recipient: Recipient = {
      key: keyFor(contact, email, phone),
      contact:
        contact.kind === "account" ? contact : { ...contact, email, phone },
      roles: [role],
    };
    this.#entries.push(recipient);
    this.#index(recipient, email, phone);
  }

  #merge(
    existing: Recipient,
    contact: Contact,
    email: string | null,
    phone: string | null
  ): void {
    if (contact.kind === "account" && existing.contact.kind === "details") {
      // The account absorbs the contact details found before it.
      existing.key = keyFor(contact, email, phone);
      existing.contact = contact;
    } else if (existing.contact.kind === "details") {
      existing.contact = {
        ...existing.contact,
        email: existing.contact.email ?? email,
        phone: existing.contact.phone ?? phone,
      };
    }
    this.#index(existing, email, phone);
  }

  #index(recipient: Recipient, email: string | null, phone: string | null) {
    if (recipient.contact.kind === "account") {
      this.#byUser.set(recipient.contact.userId, recipient);
      const own = present(recipient.contact.email, normaliseEmail);
      if (own !== null && !this.#byEmail.has(own)) {
        this.#byEmail.set(own, recipient);
      }
    }
    if (email !== null && !this.#byEmail.has(email)) {
      this.#byEmail.set(email, recipient);
    }
    if (phone !== null && !this.#byPhone.has(phone)) {
      this.#byPhone.set(phone, recipient);
    }
  }

  get recipients(): Recipient[] {
    return this.#entries;
  }
}

function keyFor(
  contact: Contact,
  email: string | null,
  phone: string | null
): string {
  if (contact.kind === "account") return `user:${contact.userId}`;
  if (email !== null) return `email:${email}`;
  if (phone !== null) return `phone:${phone}`;
  throw new Error("An unreachable contact has no recipient key");
}

/**
 * Who should receive messages for `participant` at `at`: a minor's
 * guardians, never the minor; an adult themselves, or their guardians when
 * they have no contact of their own.
 */
function routeParticipant(
  participant: Participant,
  at: Date
):
  | { to: Contact[]; role: RecipientRole }
  | { unreachable: Unreachable["reason"] } {
  const guardians = participant.guardians.filter(reachable);
  if (isUnder18On(participant.dateOfBirth, at)) {
    return guardians.length > 0
      ? { to: guardians, role: "guardian" }
      : { unreachable: "minor_without_guardian" };
  }
  if (participant.self && reachable(participant.self)) {
    return { to: [participant.self], role: "participant" };
  }
  return guardians.length > 0
    ? { to: guardians, role: "guardian" }
    : { unreachable: "no_contact" };
}

export function planAnnouncementAudience(
  snapshot: AudienceSnapshot,
  at: Date
): AudiencePlan {
  const list = new RecipientList();
  const unreachable = new Map<string, Unreachable>();

  const addParticipant = (participant: Participant) => {
    const route = routeParticipant(participant, at);
    if ("unreachable" in route) {
      unreachable.set(participant.participantProfileId, {
        participantProfileId: participant.participantProfileId,
        reason: route.unreachable,
      });
      return;
    }
    for (const contact of route.to) list.add(contact, route.role);
  };

  for (const registration of snapshot.individualRegistrations) {
    if (registration.confirmed) addParticipant(registration.participant);
  }
  for (const registration of snapshot.institutionRegistrations) {
    if (!registration.confirmed) continue;
    for (const coordinator of registration.coordinators) {
      list.add(coordinator, "coordinator");
    }
    for (const student of registration.students) {
      if (student.enrolled) addParticipant(student.participant);
    }
  }

  const recipients = list.recipients;
  const withRole = (role: RecipientRole) =>
    recipients.filter((recipient) => recipient.roles.includes(role)).length;
  return {
    recipients,
    unreachable: [...unreachable.values()],
    counts: {
      recipients: recipients.length,
      participants: withRole("participant"),
      guardians: withRole("guardian"),
      coordinators: withRole("coordinator"),
      unreachable: unreachable.size,
    },
  };
}
