import type { E164Phone } from "../../../../lib/phone";
import type { MessageChannel } from "../../notifications/domain/channels";

export type DetailsContact = {
  kind: "details";
  name: string | null;
  email: string | null;
  phone: E164Phone | null;
};

export type AccountContact = Omit<DetailsContact, "kind"> & {
  kind: "account";
  userId: string;
  preferences: { email: boolean; sms: boolean };
};

export type Contact = AccountContact | DetailsContact;
export type ChannelsForContact = (
  contact: Contact
) => readonly MessageChannel[];

export type Candidate =
  | { role: "coordinator"; contacts: readonly AccountContact[] }
  | {
      role: "participant";
      participantProfileId: string;
      contacts: readonly Contact[];
    }
  | {
      role: "guardian";
      participantProfileId: string;
      contacts: readonly Contact[];
      roster?: {
        alias: string;
        listedEmail: string | null;
        /** Position in contacts, or null if no contact corroborates the alias. */
        contactIndex: number | null;
        verifiedPhoneOwnerId?: string | undefined;
        revokedAccountIds?: ReadonlySet<string> | undefined;
      };
    };

export type Recipient = {
  /** In-memory identity key. It can contain personal data. */
  key: string;
  /** Unambiguous guardian aliases. Keep these in memory with the contact. */
  aliases: string[];
  contact: Contact;
  roles: Candidate["role"][];
};

export type AudiencePlan = {
  recipients: Recipient[];
  /** Each address appears at most once on its channel. */
  deliveries: {
    channel: MessageChannel;
    address: string;
    recipient: Recipient;
  }[];
  unreachable: {
    participantProfileId: string;
    reason: "minor_without_guardian" | "no_contact";
  }[];
  counts: {
    recipients: number;
    participants: number;
    guardians: number;
    coordinators: number;
    unreachable: number;
  };
};

function addressFor(contact: Contact, channel: MessageChannel): string | null {
  switch (channel) {
    case "email":
      return contact.email;
    case "sms":
      return contact.phone;
    case "in_app":
      return contact.kind === "account" ? contact.userId : null;
  }
}

/** A roster guardian's name corroborates their listed phone. */
export function rosterGuardianPhoneAlias({
  name,
  phone,
}: DetailsContact): string | null {
  const normalized = name?.trim().toLowerCase();
  return normalized && phone
    ? `guardian-phone:${JSON.stringify([phone, normalized])}`
    : null;
}

export type RosterContact = { contact: DetailsContact; minor: boolean };

export function rosterConflicts(roster: readonly RosterContact[]) {
  const phoneByEmail = new Map<string, E164Phone>();
  const adultsByEmail = new Map<string, Map<E164Phone | null, number>>();
  const guardianEmails = new Set<string>();
  const guardianAliasesByEmail = new Map<string, Map<E164Phone, Set<string>>>();
  const emailByAlias = new Map<string, string>();
  const sharedEmails = new Set<string>();
  const conflictingGuardianAliases = new Set<string>();
  for (const { contact, minor } of roster) {
    const { email, phone } = contact;
    if (!email) continue;
    if (!minor) {
      const adults =
        adultsByEmail.get(email) ?? new Map<E164Phone | null, number>();
      if (adults.size > 0) sharedEmails.add(email);
      adults.set(phone, (adults.get(phone) ?? 0) + 1);
      adultsByEmail.set(email, adults);
    } else guardianEmails.add(email);
    if (!phone) continue;
    const otherPhone = phoneByEmail.get(email);
    if (otherPhone && otherPhone !== phone) sharedEmails.add(email);
    phoneByEmail.set(email, phone);

    const alias = minor ? rosterGuardianPhoneAlias(contact) : null;
    if (alias === null) continue;
    const aliasesByPhone =
      guardianAliasesByEmail.get(email) ?? new Map<E164Phone, Set<string>>();
    const aliases = aliasesByPhone.get(phone) ?? new Set<string>();
    aliases.add(alias);
    if (aliases.size > 1) sharedEmails.add(email);
    aliasesByPhone.set(phone, aliases);
    guardianAliasesByEmail.set(email, aliasesByPhone);

    const otherEmail = emailByAlias.get(alias);
    if (otherEmail && otherEmail !== email)
      conflictingGuardianAliases.add(alias);
    emailByAlias.set(alias, email);
  }
  for (const email of guardianEmails) {
    if (adultsByEmail.has(email)) sharedEmails.add(email);
  }

  function hasCompetingIdentity({
    email,
    phone,
  }: Pick<DetailsContact, "email" | "phone">) {
    if (email === null) return false;
    const adults = adultsByEmail.get(email)?.get(phone) ?? 0;
    const guardians = phone
      ? (guardianAliasesByEmail.get(email)?.get(phone)?.size ?? 0)
      : 0;
    return adults + guardians > 1;
  }

  return {
    sharedEmails,
    conflictingGuardianAliases,
    hasCompetingIdentity,
    linkedGuardianIndex(
      roster: DetailsContact,
      linked: readonly AccountContact[]
    ) {
      const { email, phone } = roster;
      return linked.findIndex(
        (account) =>
          !hasCompetingIdentity({ email: account.email, phone }) &&
          (email !== null
            ? account.email === email &&
              (!sharedEmails.has(email) || account.phone === phone)
            : account.phone === phone)
      );
    },
  };
}

/** An active link on an eligible outside row, for conflict checks only. */
export type OutsideGuardianLink = {
  alias: string;
  /** Null when the linked account does not corroborate the roster alias. */
  account: Pick<AccountContact, "userId" | "email"> | null;
};

function rosterGuardianMatches(
  candidates: readonly Candidate[],
  conflictingGuardianAliases: ReadonlySet<string>,
  outsideGuardianLinks: readonly OutsideGuardianLink[]
) {
  const evidence = new Map<
    string,
    {
      emails: Set<string>;
      account: AccountContact | null;
      accountIds: Set<string>;
      emailContact: DetailsContact | null;
      conflictingContact: boolean;
      verifiedPhoneOwnerId?: string | undefined;
    }
  >();
  for (const candidate of candidates) {
    if (candidate.role !== "guardian" || !candidate.roster) continue;
    const { alias, listedEmail, contactIndex, verifiedPhoneOwnerId } =
      candidate.roster;
    const contact =
      contactIndex === null ? null : (candidate.contacts[contactIndex] ?? null);
    let group = evidence.get(alias);
    if (!group) {
      group = {
        emails: new Set(),
        account: null,
        accountIds: new Set(),
        emailContact: null,
        conflictingContact: false,
      };
      evidence.set(alias, group);
    }
    if (listedEmail) group.emails.add(listedEmail);
    group.verifiedPhoneOwnerId ??= verifiedPhoneOwnerId;
    if (contact === null) group.conflictingContact = true;
    if (contact?.kind === "account") {
      group.account = contact;
      group.accountIds.add(contact.userId);
      if (verifiedPhoneOwnerId && verifiedPhoneOwnerId !== contact.userId)
        group.conflictingContact = true;
    } else if (contact?.email) group.emailContact ??= contact;
  }

  for (const { alias, account } of outsideGuardianLinks) {
    const group = evidence.get(alias);
    if (!group) continue;
    const { emails, verifiedPhoneOwnerId } = group;
    if (
      account === null ||
      (emails.size > 0 &&
        (account.email === null || !emails.has(account.email))) ||
      (verifiedPhoneOwnerId && verifiedPhoneOwnerId !== account.userId)
    ) {
      group.conflictingContact = true;
    } else group.accountIds.add(account.userId);
  }

  // Only consistent evidence links phone-only records to a shared alias.
  const matches = new Map<string, Contact | null>();
  for (const [
    alias,
    { emails, account, accountIds, emailContact, conflictingContact },
  ] of evidence) {
    const email = emails.values().next().value;
    if (
      conflictingContact ||
      conflictingGuardianAliases.has(alias) ||
      emails.size > 1 ||
      accountIds.size > 1 ||
      (account && email && account.email !== email)
    )
      continue;
    matches.set(alias, account ?? emailContact);
  }
  return matches;
}

function recipientKey(
  candidate: Candidate,
  contact: Contact,
  alias: string | undefined,
  sharedEmails: ReadonlySet<string>
): string {
  if (contact.kind === "account") return `user:${contact.userId}`;
  if (candidate.role === "guardian") {
    if (contact.email) {
      // A shared mailbox remains one email destination across distinct contacts.
      if (!sharedEmails.has(contact.email)) return `email:${contact.email}`;
      const phoneAlias = rosterGuardianPhoneAlias(contact);
      if (phoneAlias)
        return `guardian-email:${JSON.stringify([contact.email, phoneAlias])}`;
    }
    if (alias) return alias;
  }
  if (candidate.role === "coordinator")
    throw new Error("A coordinator requires an account");
  return `${candidate.role}:${candidate.participantProfileId}`;
}

/** Counts people from their eligible channels and deduplicates addresses separately. */
export function planAnnouncementAudience(
  candidates: readonly Candidate[],
  channelsForContact: ChannelsForContact,
  {
    sharedEmails = new Set<string>(),
    conflictingGuardianAliases = new Set<string>(),
    outsideGuardianLinks = [],
  }: {
    sharedEmails?: ReadonlySet<string>;
    conflictingGuardianAliases?: ReadonlySet<string>;
    outsideGuardianLinks?: readonly OutsideGuardianLink[];
  } = {}
): AudiencePlan {
  const byKey = new Map<string, Recipient>();
  const guardianMatches = rosterGuardianMatches(
    candidates,
    conflictingGuardianAliases,
    outsideGuardianLinks
  );
  const keysByCandidate = candidates.map((candidate) =>
    candidate.contacts.map((listed, index) => {
      const roster =
        candidate.role === "guardian" &&
        candidate.roster?.contactIndex === index
          ? candidate.roster
          : undefined;
      const matched = roster ? guardianMatches.get(roster.alias) : undefined;
      const match =
        matched?.kind === "account" &&
        roster?.revokedAccountIds?.has(matched.userId)
          ? undefined
          : matched;
      const alias = match === undefined ? undefined : roster?.alias;
      const contact =
        listed.kind === "details" && !roster?.listedEmail
          ? (match ?? listed)
          : listed;
      const key = recipientKey(candidate, contact, alias, sharedEmails);
      let recipient = byKey.get(key);
      if (!recipient) {
        recipient = { key, contact, roles: [], aliases: [] };
        byKey.set(key, recipient);
      } else if (
        recipient.contact.kind === "details" &&
        contact.kind === "details" &&
        recipient.contact.phone === null &&
        contact.phone
      ) {
        recipient.contact = { ...recipient.contact, phone: contact.phone };
      }
      if (!recipient.roles.includes(candidate.role)) {
        recipient.roles.push(candidate.role);
      }
      if (alias && alias !== key && !recipient.aliases.includes(alias))
        recipient.aliases.push(alias);
      return key;
    })
  );

  const recipients: Recipient[] = [];
  const reachableKeys = new Set<string>();
  const deliveries = new Map<string, AudiencePlan["deliveries"][number]>();
  for (const recipient of byKey.values()) {
    for (const channel of channelsForContact(recipient.contact)) {
      const address = addressFor(recipient.contact, channel);
      if (address === null) continue;
      reachableKeys.add(recipient.key);
      const key = `${channel}:${address}`;
      if (!deliveries.has(key))
        deliveries.set(key, { channel, address, recipient });
    }
    if (reachableKeys.has(recipient.key)) recipients.push(recipient);
  }

  const unreachable: AudiencePlan["unreachable"] = [];
  for (const [index, candidate] of candidates.entries()) {
    if (candidate.role === "coordinator") continue;
    if (keysByCandidate[index]!.some((key) => reachableKeys.has(key))) continue;
    unreachable.push({
      participantProfileId: candidate.participantProfileId,
      reason:
        candidate.role === "guardian" ? "minor_without_guardian" : "no_contact",
    });
  }

  return {
    recipients,
    deliveries: [...deliveries.values()],
    unreachable,
    counts: {
      recipients: recipients.length,
      participants: recipients.filter(({ roles }) =>
        roles.includes("participant")
      ).length,
      guardians: recipients.filter(({ roles }) => roles.includes("guardian"))
        .length,
      coordinators: recipients.filter(({ roles }) =>
        roles.includes("coordinator")
      ).length,
      unreachable: unreachable.length,
    },
  };
}
