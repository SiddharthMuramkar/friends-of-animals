// Read-only recipient selection shared by announcements and reminders.
// Loads under plain Node (the worker), with relative imports only.

import { and, asc, eq, exists, inArray, or } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { parsePhoneNumber, type E164Phone } from "../../../lib/phone";
import type { BlindIndex } from "../../crypto/blind-index";
import type { Ciphertext, FieldCipher } from "../../crypto/field-cipher";
import type { AppDb } from "../../db/app-db";
import {
  institutionRegistration,
  notificationPreference,
  participantProfile,
  registration,
  user,
  userRole,
} from "../../db/schema";
import { sqlState } from "../../errors";
import { phoneHashOf, readStoredPhone } from "../../identity/stored-phone";
import { normaliseEmailAddress } from "../../ports/email";
import { verifiedGuardianIds } from "../guardians/domain/minor-audience";
import { guardianLinksByProfile } from "../guardians/participant-audience";
import { DEFAULT_PREFERENCES } from "../notifications/domain/delivery-plan";
import { PROFILE_PURPOSE } from "../registration/student-profile";
import { isUnder18On } from "./domain/age";
import {
  planAnnouncementAudience,
  rosterConflicts,
  rosterGuardianPhoneAlias,
  type AccountContact,
  type AudiencePlan,
  type Candidate,
  type ChannelsForContact,
  type DetailsContact,
  type OutsideGuardianLink,
  type RosterContact,
} from "./domain/audience";

type Deps = { db: AppDb; cipher: FieldCipher; blindIndex: BlindIndex };

type AudienceInput = {
  competitionId: string;
  /** The instant on which recipient ages are evaluated. */
  at: Date;
  /** Limits recipients and positive identity evidence to the selected registrations. Omit for the full roster. */
  registrationIds?: ReadonlySet<string> | undefined;
  /** Channels allowed by the caller's routes, settings and recipient preferences. */
  channelsForContact: ChannelsForContact;
};

function audienceRows(db: AppDb, competitionId: string) {
  const confirmed = alias(registration, "confirmed_registration");
  // One paid or free student confirms the school for #84. That student's
  // registration can be outside the subset requested by a reminder.
  const schoolConfirmed = exists(
    db
      .select({ id: confirmed.id })
      .from(confirmed)
      .where(
        and(
          eq(confirmed.institutionRegistrationId, institutionRegistration.id),
          eq(confirmed.competitionId, competitionId),
          eq(confirmed.route, "institution"),
          eq(confirmed.status, "confirmed")
        )
      )
  );
  return db
    .select({
      registrationId: registration.id,
      profileId: participantProfile.id,
      route: registration.route,
      institutionId: institutionRegistration.institutionId,
      ownerKind: participantProfile.ownerKind,
      ownerUserId: participantProfile.ownerUserId,
      loginUserId: participantProfile.loginUserId,
      dob: participantProfile.dobCiphertext,
      name: participantProfile.fullName,
      email: participantProfile.emailCiphertext,
      phone: participantProfile.phoneCiphertext,
      guardianName: participantProfile.guardianNameCiphertext,
      guardianEmail: participantProfile.guardianEmailCiphertext,
      guardianPhone: participantProfile.guardianPhoneCiphertext,
    })
    .from(registration)
    .innerJoin(
      participantProfile,
      eq(participantProfile.id, registration.participantProfileId)
    )
    .leftJoin(
      institutionRegistration,
      eq(institutionRegistration.id, registration.institutionRegistrationId)
    )
    .where(
      and(
        eq(registration.competitionId, competitionId),
        or(
          and(
            eq(registration.route, "individual"),
            eq(registration.status, "confirmed")
          ),
          and(
            eq(registration.route, "institution"),
            inArray(registration.status, ["confirmed", "enrolled"]),
            eq(institutionRegistration.competitionId, competitionId),
            eq(institutionRegistration.status, "active"),
            eq(
              participantProfile.managingInstitutionId,
              institutionRegistration.institutionId
            ),
            schoolConfirmed
          )
        )
      )
    )
    .orderBy(asc(registration.id));
}

function accountRows(db: AppDb) {
  return db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      emailVerified: user.emailVerified,
      phone: user.phoneCiphertext,
      phoneHash: user.phoneHash,
      phoneVerified: user.phoneVerified,
      preferences: {
        email: notificationPreference.email,
        sms: notificationPreference.sms,
      },
    })
    .from(user)
    .leftJoin(
      notificationPreference,
      eq(notificationPreference.userId, user.id)
    );
}

type AccountRow = Awaited<ReturnType<typeof accountRows>>[number];

function accountContact(deps: Deps, row: AccountRow): AccountContact {
  return {
    kind: "account",
    userId: row.id,
    name: row.name,
    email: row.emailVerified ? row.email : null,
    phone:
      row.phone && row.phoneVerified ? readStoredPhone(deps, row.phone) : null,
    preferences: row.preferences ?? DEFAULT_PREFERENCES,
  };
}

async function coordinatorIds(db: AppDb, institutionIds: readonly string[]) {
  if (institutionIds.length === 0) return [];
  const rows = await db
    .select({ userId: userRole.userId })
    .from(userRole)
    .where(
      and(
        eq(userRole.role, "institution_coordinator"),
        eq(userRole.scopeType, "institution"),
        inArray(userRole.scopeId, [...new Set(institutionIds)])
      )
    )
    .orderBy(asc(userRole.userId));
  return [...new Set(rows.map(({ userId }) => userId))];
}

type AudienceRow = Awaited<ReturnType<typeof audienceRows>>[number];

function readRosterContact(
  cipher: FieldCipher,
  row: AudienceRow,
  minor: boolean,
  email = readRosterEmail(cipher, row, minor)
): DetailsContact {
  const read = (
    purpose: keyof typeof PROFILE_PURPOSE,
    stored: Ciphertext | null
  ) =>
    stored === null ? null : cipher.decrypt(PROFILE_PURPOSE[purpose], stored);
  const rawPhone = minor
    ? read("guardianPhone", row.guardianPhone)
    : read("phone", row.phone);
  const phone = parsePhoneNumber(rawPhone ?? "");
  return {
    kind: "details",
    name: minor ? read("guardianName", row.guardianName) : row.name,
    email,
    phone: phone.ok ? phone.e164 : null,
  };
}

function readRosterEmail(
  cipher: FieldCipher,
  row: AudienceRow,
  minor: boolean
) {
  const stored = minor ? row.guardianEmail : row.email;
  if (stored === null) return null;
  const purpose = PROFILE_PURPOSE[minor ? "guardianEmail" : "email"];
  return normaliseEmailAddress(cipher.decrypt(purpose, stored)) || null;
}

function matchingRosterContacts(
  cipher: FieldCipher,
  at: Date,
  rows: readonly AudienceRow[],
  selected: readonly RosterContact[]
) {
  const selectedEmails = new Set(
    selected.flatMap(({ contact }) => (contact.email ? [contact.email] : []))
  );
  const selectedGuardianPhones = new Set(
    selected.flatMap(({ contact, minor }) =>
      minor && contact.phone ? [contact.phone] : []
    )
  );
  const selectedGuardianAliases = new Set(
    selected.flatMap(({ contact, minor }) => {
      const alias = minor ? rosterGuardianPhoneAlias(contact) : null;
      return alias === null ? [] : [alias];
    })
  );
  if (selectedEmails.size === 0 && selectedGuardianPhones.size === 0) return [];

  // Outside roster rows can supply conflict evidence for selected mailboxes and aliases.
  const matching: (RosterContact & {
    profileId: string;
    sharedGuardianAlias: string | null;
  })[] = [];
  for (const row of rows) {
    if (row.route !== "institution") continue;
    const minor = isUnder18On(cipher.decrypt(PROFILE_PURPOSE.dob, row.dob), at);
    const email = readRosterEmail(cipher, row, minor);
    const sameMailbox = email !== null && selectedEmails.has(email);
    if (!sameMailbox && selectedGuardianPhones.size === 0) continue;
    const contact = readRosterContact(cipher, row, minor, email);
    const alias = minor ? rosterGuardianPhoneAlias(contact) : null;
    const sharedGuardianAlias =
      alias && selectedGuardianAliases.has(alias) ? alias : null;
    const competingPair =
      email && contact.phone && selectedGuardianPhones.has(contact.phone);
    if (sameMailbox || sharedGuardianAlias || competingPair)
      matching.push({
        contact,
        minor,
        profileId: row.profileId,
        sharedGuardianAlias,
      });
  }
  return matching;
}

async function minorAccountsAt(deps: Deps, userIds: string[], at: Date) {
  const minors = new Set<string>();
  if (userIds.length === 0) return minors;
  const profiles = await deps.db
    .select({
      ownerKind: participantProfile.ownerKind,
      ownerUserId: participantProfile.ownerUserId,
      loginUserId: participantProfile.loginUserId,
      dob: participantProfile.dobCiphertext,
    })
    .from(participantProfile)
    .where(
      or(
        inArray(participantProfile.loginUserId, userIds),
        and(
          eq(participantProfile.ownerKind, "self"),
          inArray(participantProfile.ownerUserId, userIds)
        )
      )
    );
  for (const profile of profiles) {
    const id =
      profile.ownerKind === "self" ? profile.ownerUserId : profile.loginUserId;
    if (
      id &&
      isUnder18On(deps.cipher.decrypt(PROFILE_PURPOSE.dob, profile.dob), at)
    )
      minors.add(id);
  }
  return minors;
}

async function loadContacts(
  deps: Deps,
  userIds: string[],
  roster: DetailsContact[],
  at: Date
) {
  const emails = new Set<string>();
  const phoneHashes = new Map<E164Phone, string>();
  for (const { email, phone } of roster) {
    if (email) emails.add(email);
    if (phone && !phoneHashes.has(phone))
      phoneHashes.set(phone, phoneHashOf(deps, phone));
  }
  const rows =
    userIds.length === 0 && emails.size === 0 && phoneHashes.size === 0
      ? []
      : await accountRows(deps.db)
          .where(
            or(
              inArray(user.id, userIds),
              inArray(user.email, [...emails]),
              inArray(user.phoneHash, [...phoneHashes.values()])
            )
          )
          .catch((error: unknown) => {
            // Drizzle's query error includes the decrypted roster email binds.
            const code = sqlState(error);
            throw new Error(
              code
                ? `announcement_roster_account_lookup_failed (${code})`
                : "announcement_roster_account_lookup_failed"
            );
          });
  const byUser = new Map<string, AccountRow>();
  const byEmail = new Map<string, AccountRow>();
  const byPhoneHash = new Map<string, AccountRow>();
  for (const row of rows) {
    byUser.set(row.id, row);
    if (row.email) byEmail.set(row.email, row);
    if (row.phoneHash) byPhoneHash.set(row.phoneHash, row);
  }
  const minors = await minorAccountsAt(deps, [...byUser.keys()], at);

  function forUsers(ids: readonly string[]) {
    return ids.flatMap((id) => {
      const row = byUser.get(id);
      return row ? [accountContact(deps, row)] : [];
    });
  }

  return {
    forUsers,
    forGuardians(ids: readonly string[]) {
      return forUsers(ids.filter((id) => !minors.has(id)));
    },
    forRoster(
      listed: DetailsContact,
      {
        sharedEmail,
        competingIdentity,
        revokedAccountIds,
      }: {
        sharedEmail: boolean;
        competingIdentity: boolean;
        revokedAccountIds?: ReadonlySet<string> | undefined;
      }
    ) {
      const emailOwner = listed.email ? byEmail.get(listed.email) : undefined;
      const hash = listed.phone ? phoneHashes.get(listed.phone) : undefined;
      const phoneOwner = hash ? byPhoneHash.get(hash) : undefined;
      const minorEmail = emailOwner && minors.has(emailOwner.id);
      const minorPhone = phoneOwner && minors.has(phoneOwner.id);
      // A verified phone corroborates a shared mailbox only when it distinguishes the roster identity.
      const verifiedEmailMatch =
        !competingIdentity &&
        emailOwner?.emailVerified &&
        !minorEmail &&
        !revokedAccountIds?.has(emailOwner.id) &&
        (!sharedEmail ||
          (phoneOwner?.phoneVerified && phoneOwner.id === emailOwner.id));
      const contact = verifiedEmailMatch
        ? accountContact(deps, emailOwner)
        : {
            ...listed,
            email: minorEmail ? null : listed.email,
            phone: minorPhone ? null : listed.phone,
          };
      return {
        contact,
        minorPhone,
        verifiedPhoneOwnerId: phoneOwner?.phoneVerified
          ? phoneOwner.id
          : undefined,
      };
    },
  };
}

/** Internal server result. Authorize the calling use case and expose only counts to a preview. */
export async function loadAnnouncementAudience(
  deps: Deps,
  input: AudienceInput
): Promise<AudiencePlan> {
  const { db, cipher } = deps;
  const { registrationIds } = input;
  if (registrationIds?.size === 0)
    return planAnnouncementAudience([], input.channelsForContact);
  const rows = await audienceRows(db, input.competitionId);
  const selected = registrationIds
    ? rows.filter(({ registrationId }) => registrationIds.has(registrationId))
    : rows;
  const participants = selected.map((row) => {
    const minor = isUnder18On(
      cipher.decrypt(PROFILE_PURPOSE.dob, row.dob),
      input.at
    );
    return {
      row,
      minor,
      userId: row.ownerKind === "self" ? row.ownerUserId : row.loginUserId,
      roster:
        row.route === "institution"
          ? readRosterContact(cipher, row, minor)
          : null,
    };
  });
  const rosterContacts = participants.flatMap(({ minor, roster }) =>
    roster ? [{ contact: roster, minor }] : []
  );
  const outsideContacts = registrationIds
    ? matchingRosterContacts(
        cipher,
        input.at,
        rows.filter(
          ({ registrationId }) => !registrationIds.has(registrationId)
        ),
        rosterContacts
      )
    : [];
  const outsideAliases = outsideContacts.flatMap(
    ({ contact, profileId, sharedGuardianAlias }) =>
      sharedGuardianAlias
        ? [{ contact, profileId, alias: sharedGuardianAlias }]
        : []
  );
  const conflicts = rosterConflicts([...rosterContacts, ...outsideContacts]);
  const [coordinators, links] = await Promise.all([
    coordinatorIds(
      db,
      selected.flatMap(({ institutionId }) =>
        institutionId ? [institutionId] : []
      )
    ),
    guardianLinksByProfile(db, [
      ...participants.flatMap(({ row, minor }) =>
        minor ? [row.profileId] : []
      ),
      ...outsideAliases.map(({ profileId }) => profileId),
    ]),
  ]);
  const guardiansByProfile = new Map(
    [...links].map(([profileId, facts]) => {
      const active = verifiedGuardianIds(facts);
      const activeIds = new Set(active);
      const revokedAccountIds = new Set(
        facts.flatMap(({ userId, revoked }) =>
          revoked && !activeIds.has(userId) ? [userId] : []
        )
      );
      return [profileId, { active, revokedAccountIds }];
    })
  );
  const userIds = [
    ...new Set([
      ...coordinators,
      ...participants.flatMap(({ minor, userId }) =>
        !minor && userId ? [userId] : []
      ),
      ...participants.flatMap(({ row, minor }) =>
        minor ? (guardiansByProfile.get(row.profileId)?.active ?? []) : []
      ),
    ]),
  ];
  const outsideGuardianIds = [
    ...new Set(
      outsideAliases.flatMap(
        ({ profileId }) => guardiansByProfile.get(profileId)?.active ?? []
      )
    ),
  ];
  const [contacts, outsideAccounts] = await Promise.all([
    loadContacts(
      deps,
      userIds,
      rosterContacts.map(({ contact }) => contact),
      input.at
    ),
    loadContacts(deps, outsideGuardianIds, [], input.at),
  ]);
  const outsideGuardianLinks: OutsideGuardianLink[] = [];
  for (const { alias, contact, profileId } of outsideAliases) {
    const linked = outsideAccounts.forGuardians(
      guardiansByProfile.get(profileId)?.active ?? []
    );
    if (linked.length === 0) continue;
    const matched = linked[conflicts.linkedGuardianIndex(contact, linked)];
    outsideGuardianLinks.push({
      alias,
      account: matched
        ? { userId: matched.userId, email: matched.email }
        : null,
    });
  }

  const candidates: Candidate[] = participants.map(
    ({ row, minor, userId, roster }) => {
      const participantProfileId = row.profileId;
      const sharedEmail = roster?.email
        ? conflicts.sharedEmails.has(roster.email)
        : false;
      if (!minor) {
        return {
          participantProfileId,
          role: "participant",
          contacts: roster
            ? [
                contacts.forRoster(roster, {
                  sharedEmail,
                  competingIdentity: conflicts.hasCompetingIdentity(roster),
                }).contact,
              ]
            : contacts.forUsers(userId ? [userId] : []),
        };
      }
      const guardians = guardiansByProfile.get(participantProfileId);
      const linked = contacts.forGuardians(guardians?.active ?? []);
      if (!roster)
        return { participantProfileId, role: "guardian", contacts: linked };
      const competingIdentity = conflicts.hasCompetingIdentity(roster);
      const revokedAccountIds = guardians?.revokedAccountIds;
      const { contact, minorPhone, verifiedPhoneOwnerId } = contacts.forRoster(
        roster,
        { sharedEmail, competingIdentity, revokedAccountIds }
      );
      const alias = minorPhone ? null : rosterGuardianPhoneAlias(roster);
      // A verified link identifies a guardian for this profile. Assign its
      // account to a shared roster alias only with corroborating address evidence.
      const contactIndex =
        linked.length === 0 ? 0 : conflicts.linkedGuardianIndex(roster, linked);
      return {
        participantProfileId,
        role: "guardian",
        contacts: linked.length > 0 ? linked : [contact],
        ...(alias
          ? {
              roster: {
                alias,
                listedEmail: roster.email,
                contactIndex: contactIndex === -1 ? null : contactIndex,
                revokedAccountIds,
                verifiedPhoneOwnerId,
              },
            }
          : {}),
      };
    }
  );
  candidates.push({
    role: "coordinator",
    contacts: contacts.forUsers(coordinators),
  });
  return planAnnouncementAudience(candidates, input.channelsForContact, {
    ...conflicts,
    outsideGuardianLinks,
  });
}
