// Test helpers for adoption applications. Tests only: nothing in the app
// imports this file.
//
// FakeAdoptionPorts stands in for the modules that haven't landed on this
// branch (./application-ports.ts): it keeps grants, listings, consent,
// dates of birth and audit entries in memory, and answers the way those
// modules are specified to. createAdoptionWorld() builds on the Seam 1
// harness: real PGlite tables for applications and stories, real accounts
// signed in through the real email-code flow, and these fakes for the rest.
// Once a module lands, its fake here gives way to the real tables and its
// builder to the module's seed builder.

import type { Actor } from "../../actor";
import { DomainError } from "../../errors";
import { uuidv7 } from "../../ids";
import type { Clock } from "../../ports/clock";
import type { Harness } from "../../../test/harness";
import {
  ADOPTION_APPLICATION_RULES,
  type AdoptionApplicationAction,
  type AdoptionRole,
  type AdoptionRuleTerm,
} from "./application-policy";
import type {
  AccessResource,
  AdoptionConsentPurpose,
  AdoptionPorts,
  ApplicationListing,
  AuditEntry,
  CalendarDate,
  ConsentState,
} from "./application-ports";
import {
  adoptionApplicationUseCases,
  type ApplyToAdoptInput,
} from "./application-use-cases";
import { moveAdoptionListing } from "./domain/status";

type FakeGrant = { role: AdoptionRole; scope: "global" | string };

export type RecordedAudit = AuditEntry & { actor: Actor; at: Date };

const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The in-memory stand-ins for #58, #59, #62, #64, #78/#81, #127 and #129. */
export class FakeAdoptionPorts {
  private readonly grants = new Map<string, FakeGrant[]>();
  private readonly listings = new Map<string, ApplicationListing>();
  private readonly datesOfBirth = new Map<string, CalendarDate>();
  private readonly consentLog = new Map<
    string,
    { id: string; action: "given" | "withdrawn" }[]
  >();
  /** Purposes with a published consent document (#64 seeds them). */
  readonly publishedDocuments = new Set<AdoptionConsentPurpose>([
    "adoption_contact_sharing",
    "adoption_success_story",
  ]);
  minAdopterAgeYears = 18;
  /** Every audit entry recorded, in order. */
  readonly audit: RecordedAudit[] = [];
  readonly ports: AdoptionPorts;

  constructor(private readonly clock: Clock) {
    this.ports = {
      access: {
        authorize: async (ctx, action, resource) =>
          this.authorize(ctx.actor, action, resource ?? {}),
        coordinatedOrganisations: async ({ actor }) => {
          if (actor.kind !== "user") return [];
          const held = this.grantsOf(actor.userId).filter(
            (grant) => grant.role === "adoption_coordinator"
          );
          if (held.some((grant) => grant.scope === "global")) return "all";
          return held.map((grant) => grant.scope);
        },
      },
      audit: {
        record: async (_tx, ctx, entry) => {
          this.audit.push({ ...entry, actor: ctx.actor, at: ctx.clock.now() });
        },
      },
      listings: {
        find: async (_db, listingId) => this.listing(listingId),
        findMany: async (_db, listingIds) =>
          listingIds.flatMap((id) => {
            const found = this.listing(id);
            return found ? [found] : [];
          }),
        markAdopted: async (_tx, _ctx, listingId) => {
          const listing = this.listings.get(listingId);
          if (!listing) throw new Error(`No listing ${listingId}`);
          // #129's machine: throws for a move it doesn't allow.
          listing.status = moveAdoptionListing(
            listing.status,
            "adopted",
            "coordinator"
          );
        },
        representatives: async (_db, organisationId) =>
          [...this.grants.entries()]
            .filter(([, held]) =>
              held.some(
                (grant) =>
                  grant.role === "organisation_representative" &&
                  grant.scope === organisationId
              )
            )
            .map(([userId]) => userId),
      },
      consent: {
        give: async (_tx, ctx, { userId, purpose }) => {
          if (!this.publishedDocuments.has(purpose)) {
            return { ok: false, error: "no_published_document" };
          }
          const id = uuidv7(ctx.clock.now());
          this.log(userId, purpose).push({ id, action: "given" });
          return { ok: true, consentEventId: id };
        },
        state: async (_db, { userId, purpose }) =>
          this.consentState(userId, purpose),
      },
      people: {
        dateOfBirth: async (_db, userId) =>
          this.datesOfBirth.get(userId) ?? null,
        parseDateOfBirth: (text, at) => parseIsoDate(text, at),
        ageAt: (dateOfBirth, at) => completedYears(dateOfBirth, at),
        parsePhoneNumber: (raw) => {
          const digits = raw.replaceAll(/[\s-]/g, "");
          const match = /^(?:\+91)?([6-9]\d{9})$/.exec(digits);
          return match
            ? { ok: true, e164: `+91${match[1]}` }
            : { ok: false, reason: "not_an_indian_mobile_number" };
        },
      },
      settings: {
        minAdopterAgeYears: async () => this.minAdopterAgeYears,
      },
      cipher: {
        encrypt: (purpose, plaintext) =>
          `fake-cipher:${purpose}:${Buffer.from(plaintext).toString("base64url")}`,
        decrypt: (purpose, stored) => {
          const prefix = `fake-cipher:${purpose}:`;
          if (!stored.startsWith(prefix)) {
            throw new Error(`Not encrypted for ${purpose}`);
          }
          return Buffer.from(stored.slice(prefix.length), "base64url").toString();
        },
      },
    };
  }

  /** Gives `userId` a role at global scope or at one organisation. */
  grant(userId: string, role: AdoptionRole, scope: "global" | string): void {
    this.grantsOf(userId).push({ role, scope });
  }

  /** Puts a listing in the fake #129 table; returns it. */
  addListing(listing: ApplicationListing): ApplicationListing {
    this.listings.set(listing.id, { ...listing });
    return listing;
  }

  /** A listing as #129's table holds it now, or null. */
  listing(listingId: string): ApplicationListing | null {
    const found = this.listings.get(listingId);
    return found ? { ...found } : null;
  }

  /** Changes a listing behind the module's back, as #129's use cases would. */
  updateListing(listingId: string, change: Partial<ApplicationListing>): void {
    const listing = this.listings.get(listingId);
    if (!listing) throw new Error(`No listing ${listingId}`);
    Object.assign(listing, change);
  }

  /** The date of birth on the user's participant profile (#78, #81). */
  setDateOfBirth(userId: string, dateOfBirth: CalendarDate): void {
    this.datesOfBirth.set(userId, dateOfBirth);
  }

  /** Withdraws consent as #64's withdrawConsent would; returns the event. */
  withdrawConsent(
    userId: string,
    purpose: AdoptionConsentPurpose
  ): { consentEventId: string } {
    const id = uuidv7(this.clock.now());
    this.log(userId, purpose).push({ id, action: "withdrawn" });
    return { consentEventId: id };
  }

  consentState(userId: string, purpose: AdoptionConsentPurpose): ConsentState {
    const last = this.log(userId, purpose).at(-1);
    return last?.action ?? "none";
  }

  /** Audit entries with this action, in order. */
  auditWith(action: string): RecordedAudit[] {
    return this.audit.filter((entry) => entry.action === action);
  }

  private authorize(
    actor: Actor,
    action: AdoptionApplicationAction,
    resource: AccessResource
  ): { role: string | null } {
    const terms: readonly AdoptionRuleTerm[] =
      ADOPTION_APPLICATION_RULES[action];
    for (const term of terms) {
      const allowed = this.allows(term, actor, resource);
      if (allowed) return { role: allowed.role };
    }
    throw new DomainError("forbidden", `${actor.kind} may not ${action}`);
  }

  /** #59's rules: a role counts at global scope or a covering scope. */
  private allows(
    term: AdoptionRuleTerm,
    actor: Actor,
    resource: AccessResource
  ): { role: string | null } | null {
    switch (term) {
      case "anyone":
        return actor.kind === "system" ? null : { role: null };
      case "signed_in":
        return actor.kind === "user" ? { role: null } : null;
      case "owner":
        return actor.kind === "user" && resource.ownerId === actor.userId
          ? { role: null }
          : null;
      default: {
        if (actor.kind !== "user") return null;
        const covered = this.grantsOf(actor.userId).some(
          (grant) =>
            grant.role === term &&
            (grant.scope === "global" ||
              (resource.scopes ?? []).some((scope) => scope.id === grant.scope))
        );
        return covered ? { role: term } : null;
      }
    }
  }

  private grantsOf(userId: string): FakeGrant[] {
    let held = this.grants.get(userId);
    if (!held) {
      held = [];
      this.grants.set(userId, held);
    }
    return held;
  }

  private log(userId: string, purpose: AdoptionConsentPurpose) {
    const key = `${userId}:${purpose}`;
    let events = this.consentLog.get(key);
    if (!events) {
      events = [];
      this.consentLog.set(key, events);
    }
    return events;
  }
}

/** `YYYY-MM-DD` that exists and isn't after `at` in India, else null. */
function parseIsoDate(text: string, at: Date): CalendarDate | null {
  const match = ISO_DATE.exec(text);
  if (!match) return null;
  const date = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
  const asUtc = new Date(Date.UTC(date.year, date.month - 1, date.day));
  if (
    asUtc.getUTCFullYear() !== date.year ||
    asUtc.getUTCMonth() !== date.month - 1 ||
    asUtc.getUTCDate() !== date.day
  ) {
    return null;
  }
  return completedYears(date, at) < 0 ? null : date;
}

/** Completed years at `at` on India's calendar (no leap-day rule). */
function completedYears(dateOfBirth: CalendarDate, at: Date): number {
  const today = new Date(at.getTime() + IST_OFFSET_MS);
  const month = today.getUTCMonth() + 1;
  const day = today.getUTCDate();
  const beforeBirthday =
    month < dateOfBirth.month ||
    (month === dateOfBirth.month && day < dateOfBirth.day);
  return today.getUTCFullYear() - dateOfBirth.year - (beforeBirthday ? 1 : 0);
}

/** A signed-in account and the actor it acts as. */
export type SignedIn = { userId: string; name: string; actor: Actor };

/** An adult's date of birth at DEFAULT_TEST_INSTANT (2027): 36 years old. */
export const ADULT_BIRTH: CalendarDate = { year: 1990, month: 6, day: 15 };

/**
 * The adoption world over a harness: the use cases acting as an actor,
 * the fakes, and builders for organisations, listings and people.
 */
export async function createAdoptionWorld(h: Harness) {
  const fake = new FakeAdoptionPorts(h.clock);
  const useCases = adoptionApplicationUseCases(fake.ports);
  let listings = 0;

  async function signedIn(
    details: { name?: string } = {}
  ): Promise<SignedIn> {
    const account = await h.seed.member(details);
    return {
      userId: account.id,
      name: account.name,
      actor: await h.signIn(account),
    };
  }

  return {
    fake,
    /** The adoption use cases, acting as `actor`. */
    as: (actor: Actor) => useCases({ ...h.deps, actor }),
    /** The worker, as consumers of other modules' events run. */
    system: { kind: "system", process: "worker" } as const satisfies Actor,

    /** A verified directory listing (#127) and its representative. */
    async organisation(
      options: { verified?: boolean } = {}
    ): Promise<{ id: string; verified: boolean; representative: SignedIn }> {
      const id = uuidv7(h.clock.now());
      const representative = await signedIn({ name: "Meera Iyer" });
      fake.grant(representative.userId, "organisation_representative", id);
      return { id, verified: options.verified ?? true, representative };
    },

    /** A published adoption listing (#129) of `organisation`. */
    listing(
      organisation: { id: string; verified: boolean },
      overrides: Partial<ApplicationListing> = {}
    ): ApplicationListing {
      listings += 1;
      return fake.addListing({
        id: uuidv7(h.clock.now()),
        slug: `animal-${listings}`,
        name: `Animal ${listings}`,
        status: "published",
        organisationId: organisation.id,
        organisationVerified: organisation.verified,
        ...overrides,
      });
    },

    /** A signed-in member with a profile date of birth (adult unless given). */
    async member(
      options: { name?: string; dateOfBirth?: CalendarDate | null } = {}
    ): Promise<SignedIn> {
      const person = await signedIn({ name: options.name });
      const dateOfBirth =
        options.dateOfBirth === undefined ? ADULT_BIRTH : options.dateOfBirth;
      if (dateOfBirth) fake.setDateOfBirth(person.userId, dateOfBirth);
      return person;
    },

    /** An adoption coordinator, global or for one organisation. */
    async coordinator(scope: "global" | string = "global"): Promise<SignedIn> {
      const person = await signedIn({ name: "Kavya Rao" });
      fake.grant(person.userId, "adoption_coordinator", scope);
      return person;
    },

    /** A complete, valid application form for `listing`. */
    applicationFor(
      listing: { id: string },
      overrides: Partial<ApplyToAdoptInput> = {}
    ): ApplyToAdoptInput {
      return {
        listingId: listing.id,
        answers: {
          homeType: "apartment",
          hasOutdoorSpace: false,
          otherAnimals: "",
          experience: "Grew up with two rescued dogs.",
          availability: "Weekday evenings and weekends.",
        },
        phone: "98765 43210",
        address: "12 Lake View Road, Bandra West, Mumbai 400050",
        sharingConsent: true,
        ...overrides,
      };
    },
  };
}

export type AdoptionWorld = Awaited<ReturnType<typeof createAdoptionWorld>>;
