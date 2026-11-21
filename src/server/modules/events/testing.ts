// Test helpers for the events module. Tests only: nothing in the app
// imports this file.
//
// Until access control (#59) is in this branch, Seam 1 tests grant
// organiser roles here and read audit entries from here. Once it lands,
// tests grant roles with the seed builders and read the audit log table,
// and this access goes.

import type { Actor } from "../../actor";
import { DomainError } from "../../errors";
import type { UseCaseContext } from "../../use-cases";
import type { EventsAccess, EventsAuditEntry } from "./access";
import {
  EVENT_ORGANISER_ROLES,
  EVENTS_POLICY,
  type EventOrganiserRole,
} from "./policy";

/** A role a test can give a user, organiser or not. */
export type TestRole = EventOrganiserRole | "member" | "competition_manager";

export type AuditedEntry = EventsAuditEntry & { actor: Actor };

/** Access that decides by EVENTS_POLICY over the roles granted here. */
export class TestEventsAccess implements EventsAccess {
  /** Every audit entry, in order, with the actor who caused it. */
  readonly audited: AuditedEntry[] = [];
  readonly #roles = new Map<string, Set<TestRole>>();

  grant(user: { id: string }, role: TestRole): void {
    const held = this.#roles.get(user.id) ?? new Set<TestRole>();
    held.add(role);
    this.#roles.set(user.id, held);
  }

  async authorize(
    { actor }: UseCaseContext,
    action: keyof typeof EVENTS_POLICY
  ): Promise<{ role: EventOrganiserRole | null }> {
    if (EVENTS_POLICY[action] === "anyone") return { role: null };
    const held = actor.kind === "user" ? this.#roles.get(actor.userId) : null;
    const role = EVENT_ORGANISER_ROLES.find((wanted) => held?.has(wanted));
    if (!role) {
      throw new DomainError("forbidden", `${actor.kind} may not ${action}`);
    }
    return { role };
  }

  async recordAudit(
    _tx: unknown,
    { actor }: UseCaseContext,
    entry: EventsAuditEntry
  ): Promise<void> {
    this.audited.push({ ...entry, actor });
  }
}
