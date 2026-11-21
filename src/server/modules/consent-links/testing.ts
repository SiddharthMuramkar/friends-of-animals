// Seam 1 stand-ins for what consent links wait for (./sources.ts): a school
// registration with enrolled students, the public uses its competition
// asks about, an in-memory consent log, a field cipher, an SMS outbox and
// link tokens. `consentLinkWorld(h)` attaches them to a harness's database
// and signs in the registration's coordinator. Tests only: nothing in the
// app imports this file. When the blockers land, the world is built with
// their seed builders instead, and the assertions stay.

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
} from "node:crypto";

import type { Actor } from "@/server/actor";
import type { Clock } from "@/server/ports/clock";
import type { Harness } from "@/test/harness";

import {
  attachConsentLinkSources,
  type ConsentEventToRecord,
  type ConsentLinkSources,
  type CurrentConsent,
  type EnrolledStudent,
  type LinkSmsMessage,
  type OfferedPublicUse,
  type SchoolRegistration,
} from "./sources";

/** An event the fake consent log holds, stamped by the clock. */
export type RecordedConsentEvent = ConsentEventToRecord & { occurredAt: Date };

/** A text message the fake SMS port took. */
export type SentSms = LinkSmsMessage & { sentAt: Date };

const TOKEN = /^[A-Za-z0-9_-]{43}$/;

/** In-memory stand-ins for every source, with what tests look inside. */
export class FakeConsentLinkSources implements ConsentLinkSources {
  readonly #clock: Clock;
  readonly #registrations = new Map<string, SchoolRegistration>();
  readonly #students = new Map<string, EnrolledStudent[]>();
  readonly #offered = new Map<string, OfferedPublicUse[]>();
  readonly #cipherKey = randomBytes(32);
  readonly #indexKey = randomBytes(32);
  /** Every consent event recorded, oldest first. */
  readonly consentEvents: RecordedConsentEvent[] = [];
  /** Every SMS sent, oldest first. */
  readonly sentSms: SentSms[] = [];
  smsEnabled = false;

  constructor(clock: Clock) {
    this.#clock = clock;
  }

  addRegistration(registration: SchoolRegistration): void {
    this.#registrations.set(registration.id, registration);
    this.#students.set(registration.id, []);
  }

  enrol(registrationId: string, student: EnrolledStudent): void {
    this.#students.get(registrationId)?.push(student);
  }

  offer(competitionId: string, uses: OfferedPublicUse[]): void {
    this.#offered.set(competitionId, uses);
  }

  /** The newest SMS to `to`, if any. */
  lastSmsTo(to: string): SentSms | undefined {
    return this.sentSms.findLast((message) => message.to === to);
  }

  registrations: ConsentLinkSources["registrations"] = {
    find: async (_db, id) => this.#registrations.get(id) ?? null,
    findByRef: async (_db, ref) =>
      [...this.#registrations.values()].find((r) => r.ref === ref) ?? null,
    students: async (_db, id) => [...(this.#students.get(id) ?? [])],
  };

  consents: ConsentLinkSources["consents"] = {
    offeredUses: async (_db, competitionId) => [
      ...(this.#offered.get(competitionId) ?? []),
    ],
    current: async (_db, { profileId, competitionId }) => {
      const current: Partial<Record<string, CurrentConsent>> = {};
      for (const event of this.consentEvents) {
        if (
          event.subject.id === profileId &&
          event.competitionId === competitionId
        ) {
          current[event.purpose] = {
            status: event.action,
            documentId: event.documentId,
          };
        }
      }
      return current;
    },
    // Not rolled back with `tx`: the use cases record events last.
    record: async (_tx, ctx, event) => {
      this.consentEvents.push({ ...event, occurredAt: ctx.clock.now() });
    },
  };

  contacts: ConsentLinkSources["contacts"] = {
    encrypt: (purpose, plain) => {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", this.#cipherKey, iv);
      cipher.setAAD(Buffer.from(purpose));
      const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
      return [iv, cipher.getAuthTag(), body]
        .map((part) => part.toString("base64url"))
        .join(".");
    },
    decrypt: (purpose, stored) => {
      const [iv = "", tag = "", body = ""] = stored.split(".");
      const decipher = createDecipheriv(
        "aes-256-gcm",
        this.#cipherKey,
        Buffer.from(iv, "base64url")
      );
      decipher.setAAD(Buffer.from(purpose));
      decipher.setAuthTag(Buffer.from(tag, "base64url"));
      return Buffer.concat([
        decipher.update(Buffer.from(body, "base64url")),
        decipher.final(),
      ]).toString("utf8");
    },
    blindIndex: (purpose, normalised) =>
      createHmac("sha256", this.#indexKey)
        .update(`${purpose}\0${normalised}`)
        .digest("hex"),
    mask: (channel, normalised) => {
      if (channel === "email") {
        const at = normalised.lastIndexOf("@");
        return at <= 0 ? "***" : `${normalised[0]}***${normalised.slice(at)}`;
      }
      return `***${normalised.slice(-4)}`;
    },
  };

  sms: ConsentLinkSources["sms"] = {
    enabled: async () => this.smsEnabled,
    normalise: (raw) => {
      const digits = raw.replace(/[\s-]/g, "").replace(/^(\+91|91|0)/, "");
      return /^[6-9]\d{9}$/.test(digits) ? `+91${digits}` : null;
    },
    send: async (message) => {
      this.sentSms.push({ ...message, sentAt: this.#clock.now() });
    },
  };

  tokens: ConsentLinkSources["tokens"] = {
    create: () => {
      const token = randomBytes(32).toString("base64url");
      return { token, tokenHash: this.tokens.hash(token) };
    },
    hash: (token) => createHash("sha256").update(token).digest("hex"),
    isWellFormed: (value) => TOKEN.test(value),
  };
}

/** Fixed ids, so failures name the record. */
export const IDS = {
  greenValley: "01938a00-0000-7000-8000-00000000c001",
  riverside: "01938a00-0000-7000-8000-00000000c002",
  competition: "01938a00-0000-7000-8000-00000000c101",
  plainCompetition: "01938a00-0000-7000-8000-00000000c102",
  registration: "01938a00-0000-7000-8000-00000000c201",
  plainRegistration: "01938a00-0000-7000-8000-00000000c202",
  asha: "01938a00-0000-7000-8000-00000000c301",
  kabir: "01938a00-0000-7000-8000-00000000c302",
  zoya: "01938a00-0000-7000-8000-00000000c303",
  publicDisplayDocument: "01938a00-0000-7000-8000-00000000c401",
  socialMediaDocument: "01938a00-0000-7000-8000-00000000c402",
} as const;

export const PUBLIC_DISPLAY: OfferedPublicUse = {
  purpose: "public_display",
  documentId: IDS.publicDisplayDocument,
  version: 2,
  title: "Showing your child's work in public",
};

export const SOCIAL_MEDIA: OfferedPublicUse = {
  purpose: "social_media",
  documentId: IDS.socialMediaDocument,
  version: 1,
  title: "Sharing your child's work on social media",
};

/** Asha's guardian, as the school has them on file. */
export const GUARDIAN_EMAIL = "lakshmi.rao@example.test";
export const GUARDIAN_PHONE = "+919876543210";

export type ConsentLinkWorld = {
  sources: FakeConsentLinkSources;
  registration: SchoolRegistration;
  /** A registration for a competition that asks about no public use. */
  plainRegistration: SchoolRegistration;
  asha: EnrolledStudent;
  kabir: EnrolledStudent;
  /** Enrolled through the plain registration. */
  zoya: EnrolledStudent;
  /** Green Valley's coordinator, signed in. */
  coordinator: Actor;
};

/**
 * Green Valley School registered for a competition that asks about public
 * display and social media, with Asha and Kabir enrolled, and its
 * coordinator signed in.
 */
export async function consentLinkWorld(h: Harness): Promise<ConsentLinkWorld> {
  const sources = new FakeConsentLinkSources(h.clock);
  attachConsentLinkSources(h.db, sources);
  const registration: SchoolRegistration = {
    id: IDS.registration,
    ref: "GVS-PAW-0001",
    institutionId: IDS.greenValley,
    institutionName: "Green Valley School",
    competitionId: IDS.competition,
    competitionTitle: "Paws and Whiskers Art Contest",
  };
  const plainRegistration: SchoolRegistration = {
    id: IDS.plainRegistration,
    ref: "GVS-ESS-0002",
    institutionId: IDS.greenValley,
    institutionName: "Green Valley School",
    competitionId: IDS.plainCompetition,
    competitionTitle: "Kindness Essay Prize",
  };
  const asha = { profileId: IDS.asha, firstName: "Asha", lastName: "Rao" };
  const kabir = { profileId: IDS.kabir, firstName: "Kabir", lastName: "Singh" };
  const zoya = { profileId: IDS.zoya, firstName: "Zoya", lastName: "Khan" };
  sources.addRegistration(registration);
  sources.addRegistration(plainRegistration);
  sources.enrol(registration.id, asha);
  sources.enrol(registration.id, kabir);
  sources.enrol(plainRegistration.id, zoya);
  sources.offer(registration.competitionId, [PUBLIC_DISPLAY, SOCIAL_MEDIA]);

  const coordinator = await h.seed.member({
    name: "Meera Iyer",
    email: "meera.iyer@greenvalley.example.test",
  });
  await h.seed.grant(coordinator, {
    role: "institution_coordinator",
    scope: { type: "institution", id: IDS.greenValley },
  });
  return {
    sources,
    registration,
    plainRegistration,
    asha,
    kabir,
    zoya,
    coordinator: await h.signIn(coordinator),
  };
}

/** The `/consent/<token>` link in the newest message to `to`. */
export function linkTokenIn(text: string | undefined): string | undefined {
  return /\/consent\/([A-Za-z0-9_-]{43})(?![A-Za-z0-9_-])/.exec(text ?? "")?.[1];
}

/** The six-digit code in a message. */
export function codeIn(text: string | undefined): string | undefined {
  return /\b(\d{6})\b/.exec(text ?? "")?.[1];
}
