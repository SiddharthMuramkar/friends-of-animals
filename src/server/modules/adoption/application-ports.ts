// What adoption applications need from modules that are not on this
// branch's base yet: access and audit (#59), staff second factor (#60),
// settings (#62), consent (#64), encryption and phone numbers (#58), dates
// of birth (#78, #81), adoption and directory listings (#129, #127). Each
// member names the function it stands for and keeps that function's shape,
// so wiring a module once it lands means calling its import where the use
// cases call `ports.<group>.<member>`, then deleting the member here.
//
// Tests pass in-memory fakes (./application-testing.ts). Production doesn't
// reach these use cases until the ports are wired (src/server/app.ts).
//
// Loads under plain Node: relative imports only, no "server-only".

import type { Actor } from "../../actor";
import type { AppDb } from "../../db/app-db";
import type { Clock } from "../../ports/clock";
import type { AdoptionApplicationAction } from "./application-policy";
import type { AdoptionListingStatus } from "./domain/status";

/** A date on India's calendar with no time of day (#78's CalendarDate). */
export type CalendarDate = { year: number; month: number; day: number };

/**
 * What an action is on (#59's Resource): the organisations it sits in, by
 * directory listing id (#127 scopes representatives and coordinators to
 * one), and the user it belongs to.
 */
export type AccessResource = {
  scopes?: readonly { type: "organisation"; id: string }[];
  ownerId?: string;
};

/** One audit log entry (#59's AuditEntry): ids and statuses only. */
export type AuditEntry = {
  /** `adoption.<past-tense verb>`, e.g. `adoption.contact_shared`. */
  action: string;
  entity: { type: "adoption_application" | "adoption_story"; id: string };
  before: unknown;
  after: unknown;
  /** The role `authorize` reported, or null (the owner, the system). */
  actorRole: string | null;
};

/** An adoption listing as applications see it (#129, joined to #127). */
export type ApplicationListing = {
  id: string;
  slug: string;
  /** The animal's name. */
  name: string;
  status: AdoptionListingStatus;
  /** The directory listing that owns the animal: the organisation scope. */
  organisationId: string;
  organisationVerified: boolean;
};

/** The consent purposes this module adds to #64's catalogue. */
export type AdoptionConsentPurpose =
  | "adoption_contact_sharing"
  | "adoption_success_story";

/** A subject's consent to one purpose now (#64's ConsentState). */
export type ConsentState = "given" | "withdrawn" | "none";

/** Who acts and when, as #59's recordAudit and #64's consent take it. */
type ActingContext = { clock: Clock; actor: Actor };

export type AdoptionPorts = {
  access: {
    /**
     * #59 `authorize(ctx, action, resource)` (src/server/access/can.ts):
     * throws DomainError("forbidden") unless the platform policy allows,
     * and returns the role that allowed it, for the audit entry. #60's
     * staff rules refuse a coordinator without a second factor here.
     */
    authorize(
      ctx: { db: AppDb; actor: Actor },
      action: AdoptionApplicationAction,
      resource?: AccessResource
    ): Promise<{ role: string | null }>;
    /**
     * The organisations the acting user coordinates adoptions for, from
     * #59's `grantsOf`: "all" with a global adoption_coordinator grant,
     * else the scoped grants' directory listing ids (maybe none).
     */
    coordinatedOrganisations(ctx: {
      db: AppDb;
      actor: Actor;
    }): Promise<"all" | readonly string[]>;
  };
  audit: {
    /** #59 `recordAudit(tx, ctx, entry)`, in the caller's transaction. */
    record(tx: AppDb, ctx: ActingContext, entry: AuditEntry): Promise<void>;
  };
  listings: {
    /** #129's adoption_listing joined to #127's directory_listing. */
    find(
      db: AppDb,
      listingId: string,
      options?: { forUpdate?: boolean }
    ): Promise<ApplicationListing | null>;
    findMany(
      db: AppDb,
      listingIds: readonly string[]
    ): Promise<ApplicationListing[]>;
    /**
     * #129 `transitionAdoptionListing(ctx, tx, { listingId, to: "adopted",
     * by: "coordinator" })`: the listing machine's single writer. Sets
     * closed_at, audits and emits adoption.listing_closed. Throws for a
     * listing that can't become adopted.
     */
    markAdopted(
      tx: AppDb,
      ctx: ActingContext,
      listingId: string
    ): Promise<void>;
    /**
     * The users holding organisation_representative at the directory
     * listing (#127 grants it on verification; #59's user_role).
     */
    representatives(db: AppDb, organisationId: string): Promise<string[]>;
  };
  consent: {
    /**
     * #64: gives the user's consent to the current document of `purpose`
     * (`currentConsentDocument` + `giveConsent`'s core) in the caller's
     * transaction, and returns the consent event's id.
     */
    give(
      tx: AppDb,
      ctx: ActingContext,
      input: { userId: string; purpose: AdoptionConsentPurpose }
    ): Promise<
      | { ok: true; consentEventId: string }
      | { ok: false; error: "no_published_document" }
    >;
    /** #64 `currentConsentState(db, { subjectType: "user", … })`. */
    state(
      db: AppDb,
      input: { userId: string; purpose: AdoptionConsentPurpose }
    ): Promise<ConsentState>;
  };
  people: {
    /**
     * #78 / #81 `selfProfileDateOfBirth(db, userId)`: the user's own
     * participant profile's date of birth, or a linked teen's from the
     * child profile their login is linked to (decrypted); null if none.
     */
    dateOfBirth(db: AppDb, userId: string): Promise<CalendarDate | null>;
    /** #78 `parseDateOfBirth(text, at)`: `YYYY-MM-DD`, not in the future. */
    parseDateOfBirth(text: string, at: Date): CalendarDate | null;
    /** #78 `ageAt(dateOfBirth, at)`: completed years on India's calendar. */
    ageAt(dateOfBirth: CalendarDate, at: Date): number;
    /** #58 `parsePhoneNumber(raw)`: an Indian mobile number as E.164. */
    parsePhoneNumber(
      raw: string
    ): { ok: true; e164: string } | { ok: false; reason: string };
  };
  settings: {
    /** #62 `readSetting(db, "adoption.minAdopterAgeYears")` (default 18). */
    minAdopterAgeYears(db: AppDb): Promise<number>;
  };
  cipher: {
    /** #58 FieldCipher: `purpose` is the column, e.g. "adoption_application.phone". */
    encrypt(purpose: string, plaintext: string): string;
    decrypt(purpose: string, stored: string): string;
  };
};
