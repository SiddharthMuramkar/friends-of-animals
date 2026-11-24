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
  outbox,
  user,
} from "../../db/schema";
import { invalidInput, type InvalidInput } from "../../input";
import { readSetting } from "../settings/read";
import { failedAuthorityEmailAt } from "./authority";
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
import { hasPendingBreachFanOut } from "./record";
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

export type ListBreachesResult =
  | { ok: true; breaches: BreachListItem[]; nextCursor: string | null }
  | InvalidInput;

const cursor = z.tuple([z.enum(["0", "1"]), z.iso.datetime(), z.uuid()]);
const listInput = z.strictObject({
  cursor: z
    .string()
    .max(96)
    .transform((value) => value.split("|"))
    .pipe(cursor)
    .optional(),
});

/** Every breach, open ones first, then by when FOA became aware, newest first. */
export async function listBreaches(
  ctx: BreachContext,
  input: unknown
): Promise<ListBreachesResult> {
  await authorize(ctx, "breach.read");
  const parsed = listInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const after = parsed.data.cursor;
  const active = sql<boolean>`${breachRecord.status} <> 'closed'`;
  const rows = await ctx.db
    .select({
      id: breachRecord.id,
      title: breachRecord.title,
      status: breachRecord.status,
      severity: breachRecord.severity,
      awareAt: breachRecord.awareAt,
      cursorAwareAt: sql<string>`to_char(${breachRecord.awareAt} at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
      affectedCount: breachRecord.affectedCount,
      minorsAffected: breachRecord.minorsAffected,
    })
    .from(breachRecord)
    .where(
      after &&
        sql`(${active}, ${breachRecord.awareAt}, ${breachRecord.id})
      < (${after[0] === "1"}::boolean, ${after[1]}::timestamptz, ${after[2]}::uuid)`
    )
    .orderBy(
      desc(active),
      sql`${breachRecord.awareAt} desc nulls last`,
      sql`${breachRecord.id} desc nulls last`
    )
    .limit(BREACH_LIST_LIMIT + 1);
  const page = rows.slice(0, BREACH_LIST_LIMIT);
  const last = page.at(-1);
  return {
    ok: true,
    breaches: page.map(({ cursorAwareAt: _cursorAwareAt, ...row }) => ({
      ...row,
      title: openBreachText(ctx.cipher, "title", row.title),
    })),
    nextCursor:
      rows.length > page.length && last
        ? [
            last.status === "closed" ? "0" : "1",
            last.cursorAwareAt,
            last.id,
          ].join("|")
        : null,
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
  fanOutPending: boolean;
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
    /** When the outstanding email exhausted its attempts. */
    emailFailedAt: Date | null;
    /** Whether `breach.authorityEmail` holds a usable address. */
    emailConfigured: boolean;
  };
  notices: {
    /** People told, each once whatever the channels. */
    recipients: number;
    pending: number;
    byRole: Record<NoticeRecipientRole, number>;
  };
  canRetryPrincipalNotices: boolean;
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
        isNotNull(breachNotification.sentAt)
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
  const [pending] = await ctx.db
    .select({
      recipients: sql<number>`count(distinct ${breachNotification.recipientUserId})::int`,
    })
    .from(breachNotification)
    .where(
      and(
        eq(breachNotification.breachId, breachId),
        isNull(breachNotification.sentAt),
        isNull(breachNotification.suppressedAt)
      )
    );
  const pendingRecipients = pending?.recipients ?? 0;
  const [failedPrincipal] = await ctx.db
    .select({ id: outbox.id })
    .from(outbox)
    .where(
      and(
        eq(outbox.aggregateType, "breach"),
        eq(outbox.aggregateId, breachId),
        eq(outbox.status, "failed"),
        inArray(outbox.eventType, [
          "breach.principal_notice",
          "breach.fan_out_requested",
        ])
      )
    )
    .limit(1);

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
  const emailFailedAt =
    emailQueuedAt === null
      ? null
      : await failedAuthorityEmailAt(ctx.db, breachId);
  const fanOutPending = await hasPendingBreachFanOut(ctx.db, breachId);

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
      fanOutPending,
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
        emailFailedAt,
        emailConfigured,
      },
      notices: {
        pending: pendingRecipients,
        recipients:
          byRole.principal + byRole.guardian + byRole.principal_and_guardian,
        byRole,
      },
      canRetryPrincipalNotices: failedPrincipal !== undefined,
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
      allowedEvents: allowedBreachEvents(
        row,
        fanOutPending,
        pendingRecipients > 0
      ),
      canNotifyAuthority:
        notifiedAt === null &&
        (row.status === "closed"
          ? emailConfigured && emailFailedAt !== null
          : emailQueuedAt === null ||
            emailFailedAt !== null ||
            !emailConfigured),
    },
  };
}
