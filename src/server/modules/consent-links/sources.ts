// What consent links need from modules that haven't landed on this branch
// yet. #83 is built ahead of its blockers, so each need is a narrow
// interface here, shaped like the function the brief expects from the
// ticket that owns it:
//
//   registrations  #75a/#75b: a school registration and its enrolled
//                  students, with the institution's name (#73) and the
//                  competition's title (#70a)
//   consents       #82: the public uses a competition asks guardians about,
//                  a student's current consents, recording a consent event
//   contacts       #58: the field cipher and blind index; #74: masking
//   sms            #58: the SMS port, its sms.enabled setting, phone numbers
//   tokens         #74: link tokens
//
// Production has none of them yet. UNWIRED finds no registration, so every
// coordinator use case answers not_found and no link is ever made; it
// refuses to encrypt, send or mint a token. Seam 1 tests attach in-memory
// stand-ins to their database (./testing.ts). Once the blockers land, each
// interface gives way to a direct import of that ticket's function, and
// this file goes.
//
// Loads under plain Node (the worker): relative imports only, no
// "server-only".

import type { Actor } from "../../actor";
import type { AppDb } from "../../db/app-db";
import type { Clock } from "../../ports/clock";

/** A school's registration for a competition (#75a). */
export type SchoolRegistration = {
  id: string;
  /** The human reference the coordinator's pages use. */
  ref: string;
  institutionId: string;
  institutionName: string;
  competitionId: string;
  competitionTitle: string;
};

/** A student enrolled through a school registration (#75b). */
export type EnrolledStudent = {
  /** The student's participant profile. */
  profileId: string;
  firstName: string;
  lastName: string;
};

export interface SchoolRegistrations {
  find(db: AppDb, registrationId: string): Promise<SchoolRegistration | null>;
  findByRef(db: AppDb, ref: string): Promise<SchoolRegistration | null>;
  /** Enrolled students, in the registration's order. */
  students(db: AppDb, registrationId: string): Promise<EnrolledStudent[]>;
}

/**
 * A public use the competition asks guardians about (#82), with the exact
 * consent document version shown for it (#64, attached by #72).
 */
export type OfferedPublicUse = {
  purpose: string;
  documentId: string;
  version: number;
  title: string;
};

/** The latest consent event for one purpose; absent means never given. */
export type CurrentConsent = {
  status: "given" | "withdrawn";
  documentId: string;
};

/** One consent event, as #82's recordConsentEvent takes it. */
export type ConsentEventToRecord = {
  subject: { type: "participant_profile"; id: string };
  competitionId: string;
  purpose: string;
  documentId: string;
  action: "given" | "withdrawn";
  method: "otp_link";
  giver: {
    kind: "guardian_contact";
    contactHash: string;
    consentLinkId: string;
  };
};

export interface GuardianConsents {
  /** The public uses offered for the competition, in catalogue order. */
  offeredUses(db: AppDb, competitionId: string): Promise<OfferedPublicUse[]>;
  /** The student's current consent to each purpose for the competition. */
  current(
    db: AppDb,
    subject: { profileId: string; competitionId: string }
  ): Promise<Partial<Record<string, CurrentConsent>>>;
  /** Appends one event in `tx`; a withdrawal emits consent.withdrawn. */
  record(
    tx: AppDb,
    ctx: { clock: Clock; actor: Actor },
    event: ConsentEventToRecord
  ): Promise<void>;
}

/** How a contact is reached, in #74's terms. */
export type ContactChannel = "email" | "phone";

export interface ContactProtection {
  /** Encrypts `plain` for the column named by `purpose` (#58). */
  encrypt(purpose: string, plain: string): string;
  decrypt(purpose: string, stored: string): string;
  /** The keyed hash rows are found by (#58), of a normalised value. */
  blindIndex(purpose: string, normalised: string): string;
  /** `a***@school.test` or `***3210` (#74). */
  mask(channel: ContactChannel, normalised: string): string;
}

/** An SMS as #58's port sends it: a DLT template and its plain text. */
export type LinkSmsMessage = {
  to: string;
  template: "guardian-consent-link" | "guardian-consent-code";
  vars: Record<string, string>;
  text: string;
};

export interface LinkSms {
  /** The runtime setting sms.enabled (#58, later #62). */
  enabled(): Promise<boolean>;
  /** An Indian mobile number as typed, in E.164, or null (#58). */
  normalise(raw: string): string | null;
  send(message: LinkSmsMessage): Promise<void>;
}

export interface LinkTokens {
  /** A new 256-bit token and its hash (#74's createLinkToken). */
  create(): { token: string; tokenHash: string };
  hash(token: string): string;
  /** Whether `value` could be a token, before any lookup. */
  isWellFormed(value: string): boolean;
}

export type ConsentLinkSources = {
  registrations: SchoolRegistrations;
  consents: GuardianConsents;
  contacts: ContactProtection;
  sms: LinkSms;
  tokens: LinkTokens;
};

function waitsFor(blocker: string): () => never {
  return () => {
    throw new Error(`Consent links wait for ${blocker} to be wired`);
  };
}

/** Production's sources until the blockers land: nothing is found. */
export const UNWIRED: ConsentLinkSources = {
  registrations: {
    find: async () => null,
    findByRef: async () => null,
    students: async () => [],
  },
  consents: {
    offeredUses: async () => [],
    current: async () => ({}),
    record: waitsFor("#82"),
  },
  contacts: {
    encrypt: waitsFor("#58"),
    decrypt: waitsFor("#58"),
    blindIndex: waitsFor("#58"),
    mask: waitsFor("#74"),
  },
  sms: {
    enabled: async () => false,
    normalise: () => null,
    send: waitsFor("#58"),
  },
  tokens: {
    create: waitsFor("#74"),
    hash: waitsFor("#74"),
    isWellFormed: () => false,
  },
};

const attached = new WeakMap<AppDb, ConsentLinkSources>();

/** The sources for the database a use case or outbox handler runs on. */
export function consentLinkSources(db: AppDb): ConsentLinkSources {
  return attached.get(db) ?? UNWIRED;
}

/**
 * Seam 1 only: puts `sources` behind every consent-link use case and
 * handler that runs on `db`.
 */
export function attachConsentLinkSources(
  db: AppDb,
  sources: ConsentLinkSources
): void {
  attached.set(db, sources);
}
