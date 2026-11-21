// Test helpers for the guardians module. Tests only: nothing in the app
// imports this file.
//
// #58, #59a, #74 and #75b haven't landed on this branch, so the module runs
// over fakes of the narrow ports in ./ports.ts. `createGuardiansHarness()`
// is the Seam 1 harness with those fakes beside it: `h.as(actor)` holds the
// app's use cases and the guardians module's, as `as(actor)` will once the
// module joins src/server/app.ts. The fakes then go, and so does this file:
// tests call `createHarness()`, and assert on `user_role` and `audit_log`
// rows where they now read `h.grants` and `h.audit`.

import { createHash, randomBytes } from "node:crypto";

import type { UseCases } from "@/server/app";
import type { Actor } from "@/server/actor";
import { uuidv7 } from "@/server/ids";
import { createHarness, type Harness } from "@/test/harness";

import { guardiansUseCases, type GuardiansUseCases } from ".";
import type {
  AuditEntry,
  BlindIndex,
  ChildProfile,
  ChildProfiles,
  FieldCipher,
  GuardianFlowRole,
  GuardianPorts,
  LinkTokens,
  PhoneParser,
} from "./ports";

const base64url = (text: string) => Buffer.from(text).toString("base64url");

/**
 * #58's field cipher, faked: reversible and bound to its purpose, but never
 * the plain value, so raw rows show whether a column went through it.
 */
export function fakeCipher(): FieldCipher {
  return {
    encrypt: (purpose, plaintext) =>
      `fake-cipher:${base64url(purpose)}:${base64url(plaintext)}`,
    decrypt(purpose, stored) {
      const [tag, storedPurpose, body] = stored.split(":");
      if (tag !== "fake-cipher" || storedPurpose !== base64url(purpose)) {
        throw new Error(`Not a value stored for ${purpose}`);
      }
      return Buffer.from(body ?? "", "base64url").toString("utf8");
    },
  };
}

/** #58's blind index, faked with an unkeyed hash. */
export function fakeBlindIndex(): BlindIndex {
  return {
    of: (purpose, value) =>
      createHash("sha256").update(`${purpose}\0${value}`).digest("hex"),
  };
}

/** #58's phone reader, faked for Indian mobile numbers only. */
export const fakeParsePhone: PhoneParser = (typed) => {
  const digits = typed.replace(/[\s\-.()]/g, "").replace(/^(\+91|0)/, "");
  return /^[6-9]\d{9}$/.test(digits)
    ? { ok: true, e164: `+91${digits}` }
    : { ok: false };
};

/** #74's link tokens: 32 random bytes, stored as a SHA-256 hash. */
export function fakeLinkTokens(): LinkTokens {
  const hash = (token: string) =>
    createHash("sha256").update(token).digest("hex");
  return {
    create() {
      const token = randomBytes(32).toString("base64url");
      return { token, tokenHash: hash(token) };
    },
    hash,
    isWellFormed: (value) => /^[A-Za-z0-9_-]{43}$/.test(value),
  };
}

/** A grant #59a's user_role would hold. */
export type HeldGrant = { userId: string; role: GuardianFlowRole };

/** An audit entry with who made it, as #59a's audit_log would hold it. */
export type RecordedAudit = AuditEntry & { actor: Actor; occurredAt: Date };

/** #75b's participant profiles, held in memory. */
export class FakeChildProfiles implements ChildProfiles {
  readonly #rows = new Map<string, ChildProfile & { ownerUserId: string }>();

  async create(
    _tx: unknown,
    child: Parameters<ChildProfiles["create"]>[1]
  ): Promise<string> {
    const id = uuidv7(child.at);
    this.#rows.set(id, {
      id,
      ownerUserId: child.ownerUserId,
      firstName: child.firstName,
      lastName: child.lastName,
      dateOfBirth: child.dateOfBirth,
      loginUserId: null,
    });
    return id;
  }

  async get(_tx: unknown, ids: readonly string[]): Promise<ChildProfile[]> {
    return ids.flatMap((id) => {
      const row = this.#rows.get(id);
      if (!row) return [];
      const { ownerUserId: _owner, ...profile } = row;
      return [{ ...profile }];
    });
  }

  async linkLogin(
    _tx: unknown,
    link: { profileId: string; userId: string }
  ): Promise<boolean> {
    const row = this.#rows.get(link.profileId);
    if (!row || row.loginUserId !== null) return false;
    row.loginUserId = link.userId;
    return true;
  }

  async findByLogin(_tx: unknown, userId: string): Promise<string | null> {
    for (const row of this.#rows.values()) {
      if (row.loginUserId === userId) return row.id;
    }
    return null;
  }

  /** Every profile, as raw rows would show them. */
  get all(): readonly (ChildProfile & { ownerUserId: string })[] {
    return [...this.#rows.values()];
  }
}

export interface GuardiansHarness extends Omit<Harness, "as"> {
  /** The app's use cases and the guardians module's, acting as `actor`. */
  as(actor: Actor): UseCases & GuardiansUseCases;
  /** Global grants the module made (#59a's user_role). */
  grants: HeldGrant[];
  /** Audit entries the module recorded (#59a's audit_log). */
  audit: RecordedAudit[];
  /** Guardian-owned profiles (#75b's participant_profile). */
  profiles: FakeChildProfiles;
  /** Ids of teen-login invitations queued for their message. */
  queuedInvitations: string[];
  ports: GuardianPorts;
}

export async function createGuardiansHarness(
  options: { now?: Date | string } = {}
): Promise<GuardiansHarness> {
  const h = await createHarness(options);
  const grants: HeldGrant[] = [];
  const audit: RecordedAudit[] = [];
  const profiles = new FakeChildProfiles();
  const queuedInvitations: string[] = [];
  const ports: GuardianPorts = {
    cipher: fakeCipher(),
    blindIndex: fakeBlindIndex(),
    parsePhone: fakeParsePhone,
    grants: {
      async grantGlobal(_tx, { userId, role }) {
        if (!grants.some((g) => g.userId === userId && g.role === role)) {
          grants.push({ userId, role });
        }
      },
    },
    audit: {
      async record(_tx, { clock, actor }, entry) {
        audit.push({ ...entry, actor, occurredAt: clock.now() });
      },
    },
    linkTokens: fakeLinkTokens(),
    childProfiles: profiles,
    teenInvitations: {
      async invited(_tx, invitationId) {
        queuedInvitations.push(invitationId);
      },
    },
  };
  const guardians = guardiansUseCases(ports);
  return {
    ...h,
    as: (actor) => ({
      ...h.as(actor),
      ...guardians({ ...h.deps, actor }),
    }),
    grants,
    audit,
    profiles,
    queuedInvitations,
    ports,
  };
}
