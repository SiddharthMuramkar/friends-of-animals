// What the physical artwork module needs from modules that are not on
// this branch yet. Each member says which ticket's code provides it. Until
// they land, the use cases run only in their tests, over a stand-in
// (./testing.ts); then one adapter builds an ArtworkPlatform from the real
// modules, and src/server/app.ts composes `physicalArtworkUseCases(platform)`.
//
// Kept narrow on purpose: only what a use case here reads or calls, in
// this module's words.
//
// Loads under plain Node: relative imports only, no "server-only".

import type { Actor } from "../../actor";
import type { AppDb } from "../../db/app-db";
import type { Clock } from "../../ports/clock";
import type { PhysicalArtworkStatus } from "./domain/status";

/** What FOA staff do with physical artwork. */
export type ArtworkStaffAction =
  | "artwork.request"
  | "artwork.receive"
  | "artwork.read";

/** A code is `prefix` and `length` random symbols (#73's CodeFormat). */
export type CodeFormat = { prefix: string; length: number };

/** Who acts, and what their grants and second factor are read with. */
export type ArtworkPolicyContext = { db: AppDb; clock: Clock; actor: Actor };

/** A competition, as requesting artwork needs it. */
export type ArtworkCompetition = {
  id: string;
  /** Such as `PAWS26`: the prefix of its Artwork IDs. */
  code: string;
  /** Its physical artwork rule asks for the original work. */
  physicalArtworkRequired: boolean;
};

/** An entry, as requesting artwork needs it. */
export type ArtworkEntry = {
  id: string;
  /** The Entry ID people see. */
  code: string;
  competitionId: string;
  /** The participant's registration. */
  registrationId: string;
  /** Set when the entry came through a school. */
  institutionRegistrationId: string | null;
  /** Any `entry_status` value; the track starts at `foa_verified`. */
  status: string;
};

/** Who pays the courier. */
export type ShippingPayer = "foa" | "sender";

/** The runtime settings a request reads. */
export type ArtworkSettings = {
  /** `artwork.dispatchDays`. */
  dispatchDays: number;
  /** `artwork.dispatchReminderLeadHours`. */
  reminderLeadHours: number;
  /** `artwork.packagingInstructions`: the request form's starting text. */
  packagingInstructions: string;
  /** `artwork.shippingPayer`: the request form's starting choice. */
  shippingPayer: ShippingPayer;
  /**
   * `org.foaFacilityAddress`, where parcels go. Null where it may not be
   * used yet: the placeholder, in production.
   */
  facilityAddress: string | null;
};

/**
 * The senders an actor acts for. A school registration's coordinators
 * send its artworks; on the individual route the participant does (a
 * 13–17 participant too), or their guardian.
 */
export type SenderScope = {
  institutionRegistrationIds: readonly string[];
  registrationIds: readonly string[];
};

/** One audit log entry about one artwork. */
export type ArtworkAuditEntry = {
  action:
    | "physical_artwork.requested"
    | "physical_artwork.dispatched"
    | "physical_artwork.received";
  entity: { type: "physical_artwork"; id: string };
  /** Ids and the changed fields only. */
  before: { status: PhysicalArtworkStatus } | null;
  after: { status: PhysicalArtworkStatus } & Record<string, unknown>;
  /** The role that allowed it, from `authorizeStaff`; null for a sender. */
  actorRole: string | null;
};

export interface ArtworkPlatform {
  /**
   * #59 `authorize` with #60's second factor: throws DomainError unless a
   * role allowed for `action` (./policy.ts) covers the competition, then
   * returns that role for the audit log. Null `competitionId`: only global
   * grants count.
   */
  authorizeStaff(
    ctx: ArtworkPolicyContext,
    action: ArtworkStaffAction,
    competitionId: string | null
  ): Promise<{ role: string }>;

  /**
   * #74 (coordinators), #75 (school registrations), #78 (individual
   * registrations), #81 (guardians and 13–17 participants). Empty for a
   * visitor, the platform and anyone who sends nothing.
   */
  senderScope(db: AppDb, actor: Actor): Promise<SenderScope>;

  /** #70. Null when there is no such competition. */
  competition(db: AppDb, id: string): Promise<ArtworkCompetition | null>;

  /**
   * 85b entries with #92's `foa_verified`; ids that match nothing are left
   * out. Locks the rows (FOR UPDATE), so two requests for one entry run one
   * after the other.
   */
  entries(db: AppDb, ids: readonly string[]): Promise<ArtworkEntry[]>;

  /** #62, with each setting's default applied. */
  settings(db: AppDb): Promise<ArtworkSettings>;

  /** #59 `recordAudit`, in the caller's transaction. */
  recordAudit(
    db: AppDb,
    ctx: { clock: Clock; actor: Actor },
    entry: ArtworkAuditEntry
  ): Promise<void>;

  /**
   * #73 `withUniqueCode`: runs `attempt` with a new random code in
   * `format` until one isn't taken on `constraint`.
   */
  withUniqueCode<T>(
    options: { format: CodeFormat; constraint: string },
    attempt: (code: string) => Promise<T>
  ): Promise<T>;
}
