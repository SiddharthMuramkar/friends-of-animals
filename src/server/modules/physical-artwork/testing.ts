// Test helpers for the physical artwork module. Tests only: nothing in the
// app imports this file.
//
// `artworkWorld(h)` stands in for the modules ./platform.ts names that are
// not on this branch yet (competitions, entries, registrations, roles,
// settings, audit, codes), over a real harness: the artwork rows, the
// outbox and the accounts are real PGlite rows, the rest lives in memory
// here. When those modules land, each builder below gives way to the real
// module's seed builder, and `world.as(actor)` to `h.as(actor)`.

import type { Actor } from "../../actor";
import { DomainError } from "../../errors";
import { uuidv7 } from "../../ids";
import type { UseCaseContext } from "../../use-cases";
import { physicalArtworkUseCases } from "./index";
import type {
  ArtworkAuditEntry,
  ArtworkCompetition,
  ArtworkEntry,
  ArtworkPlatform,
  ArtworkSettings,
  SenderScope,
} from "./platform";
import { ARTWORK_STAFF_ROLES } from "./policy";

/** The part of the Seam 1 harness the world builds on. */
type HarnessLike = {
  deps: Omit<UseCaseContext, "actor">;
  seed: { member(): Promise<{ id: string }> };
};

/** Crockford base32, as #73 draws codes. */
const SYMBOLS = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** Sample values for the settings #62 will hold (HR-40). */
export const SAMPLE_ARTWORK_SETTINGS: ArtworkSettings = {
  dispatchDays: 14,
  reminderLeadHours: 72,
  packagingInstructions:
    "Lay the artwork flat between two sheets of stiff card, write its Artwork ID on the back in pencil, and seal it in a waterproof sleeve.",
  shippingPayer: "sender",
  facilityAddress:
    "Friends of Animals (sample address), 1 Example Road, Pune 411001",
};

export type AuditRecord = ArtworkAuditEntry & { actor: Actor };

const NO_SENDER: SenderScope = {
  institutionRegistrationIds: [],
  registrationIds: [],
};

type StaffGrant = { role: string; competitionId: string | null };

export function artworkWorld(h: HarnessLike) {
  const competitions = new Map<string, ArtworkCompetition>();
  const entries = new Map<string, ArtworkEntry>();
  const grants = new Map<string, StaffGrant[]>();
  const senders = new Map<string, SenderScope>();
  const audit: AuditRecord[] = [];
  /** Codes `withUniqueCode` hands out first, before counting up. */
  const queuedCodeSymbols: string[] = [];
  let codes = 0;
  let competitionCodes = 0;
  let entryCodes = 0;
  const settings: ArtworkSettings = { ...SAMPLE_ARTWORK_SETTINGS };
  const now = () => h.deps.clock.now();

  function nextSymbols(length: number): string {
    const queued = queuedCodeSymbols.shift();
    if (queued !== undefined) return queued;
    codes += 1;
    let n = codes;
    let symbols = "";
    for (let i = 0; i < length; i++) {
      symbols = SYMBOLS[n % 32]! + symbols;
      n = Math.floor(n / 32);
    }
    return symbols;
  }

  const platform: ArtworkPlatform = {
    async authorizeStaff(ctx, action, competitionId) {
      const allowed: readonly string[] = ARTWORK_STAFF_ROLES[action];
      const grant =
        ctx.actor.kind === "user"
          ? grants
              .get(ctx.actor.userId)
              ?.find(
                ({ role, competitionId: scope }) =>
                  allowed.includes(role) &&
                  (scope === null || scope === competitionId)
              )
          : undefined;
      if (!grant) {
        throw new DomainError("forbidden", `${ctx.actor.kind} may not ${action}`);
      }
      return { role: grant.role };
    },
    async senderScope(_db, actor) {
      return actor.kind === "user"
        ? (senders.get(actor.userId) ?? NO_SENDER)
        : NO_SENDER;
    },
    async competition(_db, id) {
      return competitions.get(id) ?? null;
    },
    async entries(_db, ids) {
      return ids.flatMap((id) => {
        const entry = entries.get(id);
        return entry ? [{ ...entry }] : [];
      });
    },
    async settings() {
      return { ...settings };
    },
    async recordAudit(_db, { actor }, entry) {
      audit.push({ ...entry, actor });
    },
    // Like #73: a taken code draws another, up to five tries. The caller
    // runs each attempt in a savepoint, or the retry finds its
    // transaction aborted.
    async withUniqueCode({ format, constraint }, attempt) {
      for (let tries = 1; ; tries++) {
        try {
          return await attempt(format.prefix + nextSymbols(format.length));
        } catch (error) {
          if (!isUniqueViolation(error, constraint) || tries >= 5) throw error;
        }
      }
    },
  };

  async function user(): Promise<string> {
    return (await h.seed.member()).id;
  }

  function signedIn(userId: string): Actor {
    return {
      kind: "user",
      userId,
      sessionId: uuidv7(now()),
      meta: { ip: "203.0.113.10", userAgent: "Seam 1 test" },
    };
  }

  return {
    platform,
    /** Change before acting, as a super admin would on the settings screen. */
    settings,
    /** Every audit entry recorded so far, oldest first. */
    audit,

    /** The use cases, acting as `actor`. */
    as(actor: Actor) {
      return physicalArtworkUseCases(platform)({ ...h.deps, actor });
    },

    /** Makes the next code drawn end in `symbols`. */
    queueCode(symbols: string) {
      queuedCodeSymbols.push(symbols);
    },

    /** A competition that asks for original work unless told otherwise. */
    competition(
      details: { code?: string; physicalArtworkRequired?: boolean } = {}
    ): ArtworkCompetition {
      competitionCodes += 1;
      const competition: ArtworkCompetition = {
        id: uuidv7(now()),
        code: details.code ?? `PAWS${String(25 + competitionCodes)}`,
        physicalArtworkRequired: details.physicalArtworkRequired ?? true,
      };
      competitions.set(competition.id, competition);
      return competition;
    },

    /**
     * An FOA-verified entry. A school-route entry names the institution
     * registration it came through; otherwise it is an individual's.
     */
    entry(
      competition: ArtworkCompetition,
      details: {
        status?: string;
        institutionRegistrationId?: string;
        registrationId?: string;
      } = {}
    ): ArtworkEntry {
      entryCodes += 1;
      const entry: ArtworkEntry = {
        id: uuidv7(now()),
        code: `${competition.code}-E-${String(entryCodes).padStart(5, "0")}`,
        competitionId: competition.id,
        registrationId: details.registrationId ?? uuidv7(now()),
        institutionRegistrationId: details.institutionRegistrationId ?? null,
        status: details.status ?? "foa_verified",
      };
      entries.set(entry.id, entry);
      return entry;
    },

    /** Moves an entry on, as another module would. */
    setEntryStatus(entry: ArtworkEntry, status: string) {
      entries.set(entry.id, { ...entry, status });
    },

    /** A signed-in staff member holding `role`, globally or for one competition. */
    async staff(
      role: string,
      scope: { competitionId?: string } = {}
    ): Promise<Actor> {
      const userId = await user();
      grants.set(userId, [{ role, competitionId: scope.competitionId ?? null }]);
      return signedIn(userId);
    },

    /**
     * A signed-in sender: a coordinator of school registrations, or a
     * participant or guardian acting for individual registrations.
     */
    async sender(scope: Partial<SenderScope>): Promise<Actor> {
      const userId = await user();
      senders.set(userId, { ...NO_SENDER, ...scope });
      return signedIn(userId);
    },

    /** A signed-in user who is neither staff nor a sender. */
    async member(): Promise<Actor> {
      return signedIn(await user());
    },
  };
}

export type ArtworkWorld = ReturnType<typeof artworkWorld>;

/** Postgres refusing a duplicate key on `constraint`, through any wrapper. */
function isUniqueViolation(error: unknown, constraint: string): boolean {
  for (
    let current: unknown = error;
    current instanceof Error;
    current = current.cause
  ) {
    if (
      Reflect.get(current, "code") === "23505" &&
      (Reflect.get(current, "constraint") ??
        Reflect.get(current, "constraint_name")) === constraint
    ) {
      return true;
    }
  }
  return false;
}
