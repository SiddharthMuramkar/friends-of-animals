// What the events use cases need from access control and the audit log
// (#59): `authorize` first in every use case, and `recordAudit` in the
// transaction of every change. Both are shaped like #59's `authorize` and
// `recordAudit`, so wiring those in replaces this file with two imports.
//
// Until #59 is in this branch nobody holds a role, so the app runs with
// `accessBeforeRoles`: every organiser action is refused and the public
// reads are open. Seam 1 tests pass their own access (./testing.ts).

import type { AppDb } from "../../db/app-db";
import { DomainError } from "../../errors";
import type { UseCaseContext } from "../../use-cases";
import {
  EVENTS_POLICY,
  type EventOrganiserRole,
  type EventsAction,
} from "./policy";

export type EventsAuditAction =
  | "event.created"
  | "event.updated"
  | "event.published"
  | "event.cancelled"
  | "event.completed";

export type EventsAuditEntry = {
  action: EventsAuditAction;
  entity: { type: "event"; id: string };
  /** The fields that changed, as they were; null on creation. */
  before: Record<string, unknown> | null;
  /** The same fields, as they are now. */
  after: Record<string, unknown>;
  /** The role that allowed the action, from `authorize`. */
  actorRole: EventOrganiserRole | null;
};

export type EventsAccess = {
  /**
   * Throws DomainError("forbidden") unless the actor may take `action`;
   * returns the role that allowed it, for the audit log.
   */
  authorize(
    ctx: UseCaseContext,
    action: EventsAction
  ): Promise<{ role: EventOrganiserRole | null }>;
  /** Appends one audit entry inside the change's transaction `tx`. */
  recordAudit(
    tx: AppDb,
    ctx: UseCaseContext,
    entry: EventsAuditEntry
  ): Promise<void>;
};

/** The app's access until #59: no organisers yet, public reads open. */
export const accessBeforeRoles: EventsAccess = {
  async authorize(ctx, action) {
    if (EVENTS_POLICY[action] === "anyone") return { role: null };
    throw new DomainError("forbidden", `${ctx.actor.kind} may not ${action}`);
  },
  async recordAudit() {
    // Only changes are audited, and every change is refused above.
    throw new Error("Events are not audited until access control lands");
  },
};
