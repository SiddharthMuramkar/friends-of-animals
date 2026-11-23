// Reading the breach log (#116), for breach staff.
//
//   listBreaches()           → every breach, open ones first, newest awareness first
//   getBreach({ breachId })  → one breach, decrypted, with its timeline, notice
//                              counts, who couldn't be reached, and what staff may do next
//
// Reads write nothing. The list shows no free text but the title.
//
// Loads under plain Node: relative imports only, no "server-only".

import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  sql,
} from "drizzle-orm";
import { z } from "zod";

import { authorize } from "../../access/can";
import {
  breachNotification,
  breachRecord,
  breachTimelineEvent,
  breachUnreachable,
  user,
} from "../../db/schema";
import { invalidInput, type InvalidInput } from "../../input";
import { readSetting } from "../settings/read";
import { openBreachText } from "./content";
import { configuredAuthorityEmail } from "./domain/authority-notice";
import {
  allowedBreachEvents,
  type BreachEvent,
  type BreachSeverity,
  type BreachStatus,
  type BreachTimelineKind,
} from "./domain/breach-status";
import type { NoticeRecipientRole } from "./domain/notice-recipients";
import type { BreachContext } from "./with-breach-staff";

/** The most breaches one list shows. */
export const BREACH_LIST_LIMIT = 200;

export type BreachListItem = {
  id: string;
  title: string;
  status: BreachStatus;
  severity: BreachSeverity;
  awareAt: Date;
  affectedCount: number;
  minorsAffected: boolean;
};

export type ListBreachesResult = {
  ok: true;
  breaches: BreachListItem[];
  /** More breaches exist than the list shows. */
  more: boolean;
};

/** Every breach, open ones first, then by when FOA became aware, newest first. */
export async function listBreaches(
  ctx: BreachContext
): Promise<ListBreachesResult> {
  await authorize(ctx, "breach.read");
  const rows = await ctx.db
    .select({
      id: breachRecord.id,
      title: breachRecord.title,
      status: breachRecord.status,
      severity: breachRecord.severity,
      awareAt: breachRecord.awareAt,
      affectedCount: breachRecord.affectedCount,
      minorsAffected: breachRecord.minorsAffected,
    })
    .from(breachRecord)
    .orderBy(
      sql`${breachRecord.status} = 'closed'`,
      desc(breachRecord.awareAt),
      desc(breachRecord.id)
    )
    .limit(BREACH_LIST_LIMIT + 1);
  return {
    ok: true,
    breaches: rows.slice(0, BREACH_LIST_LIMIT).map((row) => ({
      ...row,
      title: openBreachText(ctx.cipher, "title", row.title),
    })),
    more: rows.length > BREACH_LIST_LIMIT,
  };
}

export type PersonRef = { id: string; name: string };

export type BreachTimelineEntry = {
  id: string;
  kind: BreachTimelineKind;
  note: string | null;
  /** Null for the platform's own steps, or once the account is gone. */
  author: PersonRef | null;
  occurredAt: Date;
};

export type BreachView = {
  id: string;
  title: string;
  status: BreachStatus;
  severity: BreachSeverity;
  awareAt: Date;
  personalDataInvolved: boolean;
  minorsAffected: boolean;
  affectedCount: number;
  impact: string;
  containedAt: Date | null;
  principalsNotifiedAt: Date | null;
  closedAt: Date | null;
  lead: PersonRef | null;
  createdAt: Date;
  authority: {
    notifiedAt: Date | null;
    /** How the authority is being notified. */
    channel: "email" | "manual" | null;
    /** The reference of a notice filed by hand. */
    reference: string | null;
    /** When the outstanding email was requested. */
    emailQueuedAt: Date | null;
    /** When the email port accepted the notice. */
    emailSentAt: Date | null;
    /** Whether `breach.authorityEmail` holds a usable address. */
    emailConfigured: boolean;
  };
  notices: {
    /** People told, each once whatever the channels. */
    recipients: number;
    byRole: Record<NoticeRecipientRole, number>;
  };
  unreachable: { total: number; noGuardian: number; noAccount: number };
  timeline: BreachTimelineEntry[];
  /** The moves the transition table allows next. */
  allowedEvents: BreachEvent[];
  /** Whether the authority may still be told. */
  canNotifyAuthority: boolean;
};

export type GetBreachResult =
  | { ok: true; breach: BreachView }
  | InvalidInput
  | { ok: false; error: "not_found" };

const getInput = z.strictObject({ breachId: z.uuid() });

/** One breach as breach staff see it. */
export async function getBreach(
  ctx: BreachContext,
  input: unknown
): Promise<GetBreachResult> {
  await authorize(ctx, "breach.read");
  const parsed = getInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const { breachId } = parsed.data;

  const [row] = await ctx.db
    .select()
    .from(breachRecord)
    .where(eq(breachRecord.id, breachId));
  if (!row) return { ok: false, error: "not_found" };

  const events = await ctx.db
    .select()
    .from(breachTimelineEvent)
    .where(eq(breachTimelineEvent.breachId, breachId))
    .orderBy(asc(breachTimelineEvent.occurredAt), asc(breachTimelineEvent.id));
  const peopleIds = [
    ...new Set(
      [row.leadUserId, ...events.map((event) => event.authorUserId)].filter(
        (id): id is string => id !== null
      )
    ),
  ];
  const people = new Map(
    (peopleIds.length === 0
      ? []
      : await ctx.db
          .select({ id: user.id, name: user.name })
          .from(user)
          .where(inArray(user.id, peopleIds))
    ).map((person) => [person.id, person])
  );
  const personOf = (id: string | null) =>
    id === null ? null : (people.get(id) ?? null);

  const recipients = ctx.db
    .select({
      role: sql<NoticeRecipientRole>`case
        when bool_and(${breachNotification.recipientRole} = 'principal') then 'principal'
        when bool_and(${breachNotification.recipientRole} = 'guardian') then 'guardian'
        else 'principal_and_guardian'
      end`.as("role"),
    })
    .from(breachNotification)
    .where(
      and(
        eq(breachNotification.breachId, breachId),
        isNotNull(breachNotification.recipientUserId),
        isNull(breachNotification.suppressedAt)
      )
    )
    .groupBy(breachNotification.recipientUserId)
    .as("recipients");
  const noticeCounts = await ctx.db
    .select({
      role: recipients.role,
      recipients: sql<number>`count(*)::int`,
    })
    .from(recipients)
    .groupBy(recipients.role);
  const byRole: Record<NoticeRecipientRole, number> = {
    principal: 0,
    guardian: 0,
    principal_and_guardian: 0,
  };
  for (const count of noticeCounts) byRole[count.role] = count.recipients;

  const unreachableCounts = await ctx.db
    .select({
      reason: breachUnreachable.reason,
      count: sql<number>`count(*)::int`,
    })
    .from(breachUnreachable)
    .where(eq(breachUnreachable.breachId, breachId))
    .groupBy(breachUnreachable.reason);
  const unreachableOf = (reason: "no_guardian" | "no_account") =>
    unreachableCounts.find((count) => count.reason === reason)?.count ?? 0;

  const emailConfigured =
    configuredAuthorityEmail(
      await readSetting(ctx.db, "breach.authorityEmail")
    ) !== null;
  const {
    authorityEmailQueuedAt: emailQueuedAt,
    authorityEmailSentAt: emailSentAt,
    authorityNotifiedAt: notifiedAt,
  } = row;

  return {
    ok: true,
    breach: {
      id: row.id,
      title: openBreachText(ctx.cipher, "title", row.title),
      status: row.status,
      severity: row.severity,
      awareAt: row.awareAt,
      personalDataInvolved: row.personalDataInvolved,
      minorsAffected: row.minorsAffected,
      affectedCount: row.affectedCount,
      impact: openBreachText(ctx.cipher, "impact", row.impact) ?? "",
      containedAt: row.containedAt,
      principalsNotifiedAt: row.principalsNotifiedAt,
      closedAt: row.closedAt,
      lead: personOf(row.leadUserId),
      createdAt: row.createdAt,
      authority: {
        notifiedAt,
        channel:
          row.authorityReference !== null
            ? "manual"
            : emailQueuedAt !== null || emailSentAt !== null
              ? "email"
              : null,
        reference: openBreachText(
          ctx.cipher,
          "authorityReference",
          row.authorityReference
        ),
        emailQueuedAt,
        emailSentAt,
        emailConfigured,
      },
      notices: {
        recipients:
          byRole.principal + byRole.guardian + byRole.principal_and_guardian,
        byRole,
      },
      unreachable: {
        total: unreachableOf("no_guardian") + unreachableOf("no_account"),
        noGuardian: unreachableOf("no_guardian"),
        noAccount: unreachableOf("no_account"),
      },
      timeline: events.map((event) => ({
        id: event.id,
        kind: event.kind,
        note: openBreachText(ctx.cipher, "note", event.note),
        author: personOf(event.authorUserId),
        occurredAt: event.occurredAt,
      })),
      allowedEvents: allowedBreachEvents(row),
      canNotifyAuthority:
        row.status !== "closed" &&
        notifiedAt === null &&
        (emailQueuedAt === null || !emailConfigured),
    },
  };
}
