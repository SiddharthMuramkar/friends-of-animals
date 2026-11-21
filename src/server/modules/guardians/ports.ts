// What the guardians module needs from units that haven't landed on this
// branch yet, as narrow stand-ins shaped like those units' real APIs, so
// wiring each one is a swap of imports, not a rewrite. Until then, Seam 1
// tests run the module over fakes of these ports (./testing.ts), and the
// module stays out of `as(actor)` in src/server/app.ts.
//
//   cipher, blindIndex, parsePhone  #58   Deps.cipher, Deps.blindIndex,
//                                         src/lib/phone.ts parsePhoneNumber
//   grants, audit                   #59a  user_role rows, recordAudit()
//   linkTokens                      #74   src/server/tokens/link-token.ts
//   childProfiles                   #75b  participant_profile rows with
//                                         owner_kind 'guardian'
//   teenInvitations                 #69   emit() of guardian.teen_invited,
//                                         delivered by sendTeenInvitation
//
// Loads under plain Node: types only.

import type { Actor } from "../../actor";
import type { AppDb } from "../../db/app-db";
import type { Clock } from "../../ports/clock";
import type { UseCaseContext } from "../../use-cases";
import type { CalendarDate } from "../participants/domain/age";

/** #58's field cipher: encrypts a personal-data column, bound to it. */
export interface FieldCipher {
  encrypt(purpose: string, plaintext: string): string;
  /** Throws if `stored` was changed or stored for another purpose. */
  decrypt(purpose: string, stored: string): string;
}

/** #58's blind index: a keyed hash to find a row by an encrypted value. */
export interface BlindIndex {
  of(purpose: string, value: string): string;
}

/** #58's reader for a phone number as typed: E.164 when it is one. */
export type PhoneParser = (
  typed: string
) => { ok: true; e164: string } | { ok: false };

/** The roles the guardian flows grant (#59a's `role` enum has both). */
export type GuardianFlowRole = "guardian" | "participant";

/** #59a: a global grant, written in the caller's transaction. */
export interface Grants {
  /** Grants `role` everywhere; holding it already changes nothing. */
  grantGlobal(
    tx: AppDb,
    grant: { userId: string; role: GuardianFlowRole; at: Date }
  ): Promise<void>;
}

/** One audit log entry, as #59a's recordAudit takes it. */
export type AuditEntry = {
  /** `<entity>.<past-tense verb>`, e.g. `guardian.verified`. */
  action: string;
  entity: { type: string; id: string };
  /** Ids and changed fields only, never names, contacts or dates of birth. */
  before: unknown;
  after: unknown;
  /** The role that allowed the action, or null. */
  actorRole: GuardianFlowRole | null;
};

/** #59a's audit log, appended in the caller's transaction. */
export interface Audit {
  record(
    tx: AppDb,
    ctx: { clock: Clock; actor: Actor },
    entry: AuditEntry
  ): Promise<void>;
}

/** #74's secret link tokens: only the hash is stored and looked up. */
export interface LinkTokens {
  create(): { token: string; tokenHash: string };
  hash(token: string): string;
  /** Whether `value` could be a token, so junk is refused unlooked-up. */
  isWellFormed(value: string): boolean;
}

/** A guardian-owned participant profile, as this module reads it. */
export type ChildProfile = {
  id: string;
  firstName: string;
  lastName: string;
  dateOfBirth: CalendarDate;
  /** The child's own login (13 to 17, linked), or null. */
  loginUserId: string | null;
};

/**
 * #75b's participant_profile, for the rows a guardian owns. The profile
 * keeps the child's name and date of birth (encrypted there); this module
 * keeps who looks after the child (guardian_link).
 */
export interface ChildProfiles {
  /** Creates a guardian-owned profile with no login; returns its id. */
  create(
    tx: AppDb,
    child: {
      ownerUserId: string;
      firstName: string;
      lastName: string;
      dateOfBirth: CalendarDate;
      at: Date;
    }
  ): Promise<string>;
  /** The profiles with these ids that exist. */
  get(tx: AppDb, ids: readonly string[]): Promise<ChildProfile[]>;
  /**
   * Sets a profile's login if it has none; false, changing nothing, if it
   * has one or doesn't exist.
   */
  linkLogin(
    tx: AppDb,
    link: { profileId: string; userId: string; at: Date }
  ): Promise<boolean>;
  /** The id of the profile `userId` is the login of, if any. */
  findByLogin(tx: AppDb, userId: string): Promise<string | null>;
}

/** #61/#69: the teen-login invitation message, sent after commit. */
export interface TeenInvitationOutbox {
  /** Queues the message for this invitation in the caller's transaction. */
  invited(tx: AppDb, invitationId: string): Promise<void>;
}

export type GuardianPorts = {
  cipher: FieldCipher;
  blindIndex: BlindIndex;
  parsePhone: PhoneParser;
  grants: Grants;
  audit: Audit;
  linkTokens: LinkTokens;
  childProfiles: ChildProfiles;
  teenInvitations: TeenInvitationOutbox;
};

/** What the guardians use cases run with: the deps, the actor, the ports. */
export type GuardiansContext = UseCaseContext & GuardianPorts;
