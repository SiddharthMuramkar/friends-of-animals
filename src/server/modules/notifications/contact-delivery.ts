// External delivery for service messages that can reach accounts and
// contact details (#84, F13). Both paths claim the delivery for the same
// event, template, channel and recipient, even when their address changes.
// The claim stores only blind indexes of recipient keys. Before calling the port, a run
// claims the row by moving it to `sending` (compare-and-set), so an
// overlapping run of the same event leaves it alone and retries later; a
// claim older than SENDING_LEASE_MINUTES is taken over, as its run died.
// A worker that dies between the port call and marking the row sent sends
// that message again; the ports take no idempotency key yet.
//
// Its thrown messages name ids only, never an address or a number.
//
// Loads under plain Node (the worker): relative imports only.

import {
  and,
  arrayOverlaps,
  asc,
  eq,
  inArray,
  isNull,
  or,
  sql,
} from "drizzle-orm";

import { parsePhoneNumber, type E164Phone } from "../../../lib/phone";
import type { AppDb } from "../../db/app-db";
import { messageDelivery, type MessageTemplateRow } from "../../db/schema";
import { uuidv7 } from "../../ids";
import type { Delivery, OutboxDeps } from "../../outbox";
import { normaliseEmailAddress, oneLineSubject } from "../../ports/email";
import type { MessageChannel } from "./domain/channels";
import {
  DEFAULT_PREFERENCES,
  planDelivery,
  type DeliveryPlan,
  type DeliveryPlanInput,
  type SuppressionReason,
} from "./domain/delivery-plan";
import {
  renderEmailHtml,
  renderTemplate,
  templatePlaceholders,
} from "./domain/template";

/** The blind index purpose of a destination on its delivery row. */
export const CONTACT_HASH_PURPOSE = "message_delivery.contact_hash";

/** How long a claim holds before another run may take it over. */
export const SENDING_LEASE_MINUTES = 10;
const BUSY = Symbol("busy");

export type ContactMessage = {
  delivery: Delivery;
  route: {
    templateKey: string;
    channels: readonly MessageChannel[];
    requiredByLaw: boolean;
  };
  templates: Partial<Record<MessageChannel, MessageTemplateRow>>;
  /** The stable `user:<id>` key or one of the contact's normalized addresses. */
  contactKey: string;
  /** Unambiguous identity aliases for reconciling email across retries. */
  contactAliases?: readonly string[];
  /** The address and the E.164 number to send to; null where there is none. */
  email: string | null;
  phone: string | null;
  values: Record<string, string>;
};

type Key = {
  eventId: string;
  templateKey: string;
  contactHash: string;
  recipientAccountHash: string | null;
  channel: "email" | "sms";
};

type RecipientDetails = Pick<
  ContactMessage,
  "route" | "templates" | "email" | "phone"
>;

function destinations({
  email,
  phone,
}: Pick<ContactMessage, "email" | "phone">) {
  const parsedPhone = phone === null ? null : parsePhoneNumber(phone);
  return {
    email: email === null ? null : normaliseEmailAddress(email) || null,
    phone: parsedPhone?.ok ? parsedPhone.e164 : null,
  };
}

/** Accounts use their preferences and can receive inbox messages. */
export function planServiceDelivery(
  message: RecipientDetails,
  smsEnabled: boolean,
  accountPreferences?: DeliveryPlanInput["preferences"]
): DeliveryPlan {
  const { email, phone } = destinations(message);
  const plan = planDelivery({
    routeChannels: message.route.channels,
    requiredByLaw: message.route.requiredByLaw,
    preferences: accountPreferences ?? DEFAULT_PREFERENCES,
    messagesConsent: true,
    smsEnabled,
    smsTemplateRegistered: Boolean(message.templates.sms?.dltTemplateId),
    contact: { email: email !== null, verifiedPhone: phone !== null },
  });
  return accountPreferences
    ? plan
    : {
        ...plan,
        deliver: plan.deliver.filter((channel) => channel !== "in_app"),
      };
}

/** Sends one route's external channels to a recipient. */
export async function sendToContact(
  deps: OutboxDeps,
  message: ContactMessage,
  smsEnabled: boolean,
  plan = planServiceDelivery(message, smsEnabled)
): Promise<unknown> {
  const { email, phone } = destinations(message);
  const hash = (alias: string) =>
    deps.blindIndex.of(CONTACT_HASH_PURPOSE, alias);
  const recipientAccountHash = message.contactKey.startsWith("user:")
    ? hash(message.contactKey)
    : null;
  const emailIdentityHashes = [
    ...new Set(
      (message.contactAliases ?? []).map((alias) =>
        hash(
          alias.startsWith("phone:")
            ? `sms:${alias.slice("phone:".length)}`
            : alias
        )
      )
    ),
  ];
  const keyOf = (channel: Key["channel"]): Key => {
    const destination = channel === "email" ? email : phone;
    return {
      eventId: message.delivery.eventId,
      templateKey: message.route.templateKey,
      contactHash: hash(
        destination === null ? message.contactKey : `${channel}:${destination}`
      ),
      recipientAccountHash,
      channel,
    };
  };

  for (const { channel, reason } of plan.suppressed) {
    if (channel !== "in_app")
      await recordSuppressed(deps, keyOf(channel), reason);
  }
  let failure: unknown = null;
  for (const channel of plan.deliver) {
    if (channel === "in_app") continue;
    const error = await deliver(
      deps,
      { ...message, email, phone },
      keyOf(channel),
      // A shared number claims one text by destination and cannot join email identities.
      channel === "email" ? emailIdentityHashes : []
    );
    failure ??= error;
  }
  return failure;
}

const CONTACT_ONCE = [
  messageDelivery.eventId,
  messageDelivery.templateKey,
  messageDelivery.contactHash,
  messageDelivery.channel,
];

async function lockClaims(db: AppDb, key: Key): Promise<void> {
  // Serialize reconciliation even when two runs see different destinations and
  // neither has inserted a row. Release the lock before calling a provider.
  const scope = `${key.eventId}:${key.templateKey}:${key.channel}`;
  await db.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${scope}, 0))`
  );
}

async function recordSuppressed(
  { db, clock }: OutboxDeps,
  key: Key,
  reason: SuppressionReason
): Promise<void> {
  const now = clock.now();
  await db.transaction(async (tx) => {
    await lockClaims(tx, key);
    await tx
      .insert(messageDelivery)
      .values({
        id: uuidv7(now),
        ...key,
        status: "suppressed",
        reason,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing({ target: CONTACT_ONCE });
  });
}

/**
 * Claims the row for this run, null when it is done already, or
 * BUSY while another run holds a fresh claim.
 */
async function claim(
  db: AppDb,
  now: Date,
  key: Key,
  recipientHashes: string[],
  version: number
): Promise<{ id: string; attempts: number } | null | typeof BUSY> {
  const stale = new Date(now.getTime() - SENDING_LEASE_MINUTES * 60_000);
  // An account's destination must match an actual delivery. A prior contact
  // may carry it as a roster alias even when the message went to someone else.
  const aliases = recipientHashes.filter(
    (hash) => key.recipientAccountHash === null || hash !== key.contactHash
  );
  return db.transaction(async (tx) => {
    await lockClaims(tx, key);
    const rows = await tx
      .select({
        id: messageDelivery.id,
        status: messageDelivery.status,
        updatedAt: messageDelivery.updatedAt,
        contactHash: messageDelivery.contactHash,
        recipientAccountHash: messageDelivery.recipientAccountHash,
        recipientHashes: messageDelivery.recipientHashes,
      })
      .from(messageDelivery)
      .where(
        and(
          eq(messageDelivery.eventId, key.eventId),
          eq(messageDelivery.templateKey, key.templateKey),
          eq(messageDelivery.channel, key.channel),
          or(
            eq(messageDelivery.contactHash, key.contactHash),
            key.recipientAccountHash === null
              ? undefined
              : eq(
                  messageDelivery.recipientAccountHash,
                  key.recipientAccountHash
                ),
            aliases.length === 0
              ? undefined
              : and(
                  isNull(messageDelivery.recipientAccountHash),
                  or(
                    inArray(messageDelivery.contactHash, aliases),
                    arrayOverlaps(messageDelivery.recipientHashes, aliases)
                  )
                )
          )
        )
      )
      .orderBy(asc(messageDelivery.createdAt), asc(messageDelivery.id))
      .for("update");

    const hashes = new Set(recipientHashes);
    for (const row of rows) {
      if (row.contactHash !== null) hashes.add(row.contactHash);
      for (const alias of row.recipientHashes ?? []) hashes.add(alias);
    }

    const done = rows.find((row) => row.status === "sent");
    const inFlight = rows.find(
      (row) => row.status === "sending" && row.updatedAt >= stale
    );
    const existing =
      done ??
      inFlight ??
      rows.find((row) => row.contactHash === key.contactHash) ??
      rows[0];
    if (existing && (done || inFlight)) {
      const accountHash =
        existing.recipientAccountHash ?? key.recipientAccountHash;
      if (
        accountHash !== existing.recipientAccountHash ||
        hashes.size > (existing.recipientHashes?.length ?? 0)
      ) {
        await tx
          .update(messageDelivery)
          .set({
            recipientAccountHash: accountHash,
            recipientHashes: [...hashes],
          })
          .where(eq(messageDelivery.id, existing.id));
      }
      return done ? null : BUSY;
    }

    const claimed = {
      contactHash: key.contactHash,
      recipientAccountHash:
        key.recipientAccountHash ?? existing?.recipientAccountHash ?? null,
      status: "sending" as const,
      templateVersion: version,
      recipientHashes: [...hashes],
      updatedAt: now,
    };
    const returning = {
      id: messageDelivery.id,
      attempts: messageDelivery.attempts,
    };
    const [row] = existing
      ? await tx
          .update(messageDelivery)
          .set({
            ...claimed,
            reason: null,
            attempts: sql`${messageDelivery.attempts} + 1`,
          })
          .where(eq(messageDelivery.id, existing.id))
          .returning(returning)
      : await tx
          .insert(messageDelivery)
          .values({
            ...key,
            ...claimed,
            id: uuidv7(now),
            attempts: 1,
            createdAt: now,
          })
          .returning(returning);
    return row!;
  });
}

async function deliver(
  deps: OutboxDeps,
  message: Omit<ContactMessage, "phone"> & { phone: E164Phone | null },
  key: Key,
  recipientHashes: string[]
): Promise<unknown> {
  const { channel } = key;
  const template = message.templates[channel]!;
  const now = deps.clock.now();
  const claimed = await claim(
    deps.db,
    now,
    key,
    recipientHashes,
    template.version
  );
  if (claimed === null) return null;
  if (claimed === BUSY) {
    return new Error(
      `Delivery of event ${key.eventId} on ${channel} is being sent by another run`
    );
  }
  const owned = and(
    eq(messageDelivery.id, claimed.id),
    eq(messageDelivery.attempts, claimed.attempts)
  );
  try {
    if (channel === "email") {
      const body = renderTemplate(template.body, message.values);
      await deps.email.send({
        to: message.email!,
        subject:
          template.subject === null
            ? ""
            : oneLineSubject(renderTemplate(template.subject, message.values)),
        text: body,
        html: renderEmailHtml(body),
      });
    } else {
      const vars = Object.fromEntries(
        templatePlaceholders(template.body)
          .filter(
            (name) =>
              template.variables.includes(name) &&
              Object.hasOwn(message.values, name)
          )
          .map((name) => [name, message.values[name]!])
      );
      await deps.sms.send({
        to: message.phone!,
        template: "message",
        dltTemplateId: template.dltTemplateId!,
        vars,
        text: renderTemplate(template.body, vars),
      });
    }
  } catch (error) {
    await deps.db
      .update(messageDelivery)
      .set({ status: "failed", updatedAt: deps.clock.now() })
      .where(owned);
    return error;
  }
  await deps.db
    .update(messageDelivery)
    .set({ status: "sent", updatedAt: deps.clock.now() })
    .where(owned);
  return null;
}
