// dispatchEvent(deps, delivery): the outbox handler notifications.dispatch.
// Every domain event reaches it; it sends what the event's enabled route
// rows name, and nothing when there are none.
//
// For each route and each recipient its audience resolves to, it reads the
// recipient's contacts, channel choices and messages consent and the SMS
// switch, lets planDelivery (./domain/delivery-plan.ts) choose the
// channels, renders the template and sends:
//
// - in-app: the inbox item and its delivery row in one transaction;
// - email and SMS: a delivery row first, then the port, then the row is
//   marked sent (or failed, and the error rethrown so the outbox retries).
//
// The delivery row's unique key (event, template, recipient, channel)
// makes each message go once however often the outbox delivers the event:
// a sent, suppressed or delivered in-app row is never done again. A worker
// that dies between the port call and marking the row sent sends that
// email or SMS again on the retry; the ports take no idempotency key yet.
//
// Its own thrown messages name ids only, never an address, a number or a
// name: the outbox keeps them for staff (src/server/outbox/handlers.ts).
//
// Loads under plain Node (the worker): relative imports only.

import { and, asc, eq, sql } from "drizzle-orm";

import type { E164Phone } from "../../../lib/phone";
import { currentConsent } from "../../consent/domain/consent-state";
import { subjectEvents } from "../../consent/repository";
import type { AppDb } from "../../db/app-db";
import {
  inboxItem,
  messageDelivery,
  messageRoute,
  messageTemplate,
  notificationPreference,
  user,
  type MessageRouteRow,
  type MessageTemplateRow,
} from "../../db/schema";
import { readStoredPhone } from "../../identity/stored-phone";
import { uuidv7 } from "../../ids";
import type { Delivery, OutboxDeps } from "../../outbox";
import { AUDIENCES, EVENT_VARIABLES, isAudienceKey } from "./audiences";
import type { MessageChannel } from "./domain/channels";
import { planDelivery, type SuppressionReason } from "./domain/delivery-plan";
import { renderEmailHtml, renderTemplate } from "./domain/template";
import { DEFAULT_LOCALE } from "./locale";

/** A user's channel choices while they have made none. */
export const DEFAULT_PREFERENCES = { email: true, sms: true } as const;

type Templates = Partial<Record<MessageChannel, MessageTemplateRow>>;

type Recipient = {
  id: string;
  name: string;
  email: string | null;
  phone: E164Phone | null;
};

type Message = {
  delivery: Delivery;
  route: MessageRouteRow;
  templates: Templates;
  recipient: Recipient;
  values: Record<string, string>;
};

export async function dispatchEvent(
  deps: OutboxDeps,
  delivery: Delivery
): Promise<void> {
  const routes = await deps.db
    .select()
    .from(messageRoute)
    .where(
      and(
        eq(messageRoute.eventType, delivery.eventType),
        eq(messageRoute.enabled, true)
      )
    )
    .orderBy(asc(messageRoute.templateKey), asc(messageRoute.audience));
  if (routes.length === 0) return;

  const smsEnabled = await deps.settings.get("sms.enabled");
  const eventValues = await (
    EVENT_VARIABLES[delivery.eventType].load as (
      db: AppDb,
      delivery: Delivery
    ) => Promise<Record<string, string>>
  )(deps.db, delivery);
  const failures: { deliveryId: string; error: unknown }[] = [];

  for (const route of routes) {
    if (!isAudienceKey(route.audience)) {
      throw new Error(`Route ${route.id} names an unknown audience`);
    }
    const templates = await templatesFor(deps.db, route.templateKey);
    if (!templates.email || !templates.in_app) {
      throw new Error(`Template ${route.templateKey} lacks email or in-app`);
    }
    const userIds = await AUDIENCES[route.audience](deps.db, delivery);
    for (const userId of userIds) {
      const recipient = await recipientOf(deps, userId);
      // An account erased since the event gets nothing.
      if (!recipient) continue;
      const message: Message = {
        delivery,
        route,
        templates,
        recipient,
        values: { ...eventValues, "recipient.name": recipient.name },
      };
      failures.push(...(await sendMessage(deps, message, smsEnabled)));
    }
  }
  // The port's own error, as the outbox keeps it for staff (masked by
  // src/server/outbox/failure.ts); every failed row is retried with it.
  if (failures.length > 0) throw failures[0]!.error;
}

async function templatesFor(db: AppDb, key: string): Promise<Templates> {
  const rows = await db
    .select()
    .from(messageTemplate)
    .where(
      and(
        eq(messageTemplate.key, key),
        eq(messageTemplate.locale, DEFAULT_LOCALE)
      )
    );
  return Object.fromEntries(rows.map((row) => [row.channel, row]));
}

async function recipientOf(
  deps: OutboxDeps,
  userId: string
): Promise<Recipient | null> {
  const [row] = await deps.db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      phoneCiphertext: user.phoneCiphertext,
      phoneVerified: user.phoneVerified,
    })
    .from(user)
    .where(eq(user.id, userId));
  if (!row) return null;
  const phone =
    row.phoneVerified && row.phoneCiphertext
      ? readStoredPhone(deps, row.phoneCiphertext)
      : null;
  return { id: row.id, name: row.name, email: row.email, phone };
}

/** The user's channel choices, or the defaults while they made none. */
export async function preferencesOf(
  db: AppDb,
  userId: string
): Promise<{ email: boolean; sms: boolean }> {
  const [row] = await db
    .select({
      email: notificationPreference.email,
      sms: notificationPreference.sms,
    })
    .from(notificationPreference)
    .where(eq(notificationPreference.userId, userId));
  return row ?? { ...DEFAULT_PREFERENCES };
}

/**
 * Only a withdrawal stops messages: someone who never answered the
 * messages consent (#64) still gets their account's messages.
 */
async function messagesConsentOf(db: AppDb, userId: string) {
  const events = await subjectEvents(
    db,
    { type: "user", id: userId },
    "messages"
  );
  return currentConsent(events).status !== "withdrawn";
}

async function sendMessage(
  deps: OutboxDeps,
  message: Message,
  smsEnabled: boolean
): Promise<{ deliveryId: string; error: unknown }[]> {
  const { route, templates, recipient } = message;
  const plan = planDelivery({
    routeChannels: route.channels,
    requiredByLaw: route.requiredByLaw,
    preferences: await preferencesOf(deps.db, recipient.id),
    messagesConsent: await messagesConsentOf(deps.db, recipient.id),
    smsEnabled,
    smsTemplateRegistered: Boolean(templates.sms?.dltTemplateId),
    contact: {
      email: recipient.email !== null,
      verifiedPhone: recipient.phone !== null,
    },
  });

  for (const { channel, reason } of plan.suppressed) {
    await recordSuppressed(deps, message, channel, reason);
  }
  const failures: { deliveryId: string; error: unknown }[] = [];
  for (const channel of plan.deliver) {
    if (channel === "in_app") {
      await deliverInApp(deps, message);
      continue;
    }
    const failure = await deliverByPort(deps, message, channel);
    if (failure) failures.push(failure);
  }
  return failures;
}

function deliveryKey(message: Message, channel: MessageChannel) {
  return {
    eventId: message.delivery.eventId,
    templateKey: message.route.templateKey,
    userId: message.recipient.id,
    channel,
  };
}

const ONCE_TARGET = [
  messageDelivery.eventId,
  messageDelivery.templateKey,
  messageDelivery.userId,
  messageDelivery.channel,
];

async function recordSuppressed(
  { db, clock }: OutboxDeps,
  message: Message,
  channel: MessageChannel,
  reason: SuppressionReason
): Promise<void> {
  const now = clock.now();
  await db
    .insert(messageDelivery)
    .values({
      id: uuidv7(now),
      ...deliveryKey(message, channel),
      status: "suppressed",
      reason,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing({ target: ONCE_TARGET });
}

function rendered(message: Message, channel: MessageChannel) {
  const template = message.templates[channel]!;
  return {
    version: template.version,
    subject:
      template.subject === null
        ? null
        : renderTemplate(template.subject, message.values),
    body: renderTemplate(template.body, message.values),
    dltTemplateId: template.dltTemplateId,
  };
}

async function deliverInApp(
  { db, clock }: OutboxDeps,
  message: Message
): Promise<void> {
  const content = rendered(message, "in_app");
  const now = clock.now();
  await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(messageDelivery)
      .values({
        id: uuidv7(now),
        ...deliveryKey(message, "in_app"),
        templateVersion: content.version,
        status: "sent",
        attempts: 1,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing({ target: ONCE_TARGET })
      .returning({ id: messageDelivery.id });
    // Already in the inbox from an earlier delivery of this event.
    if (!created) return;
    await tx.insert(inboxItem).values({
      id: uuidv7(now),
      userId: message.recipient.id,
      deliveryId: created.id,
      templateKey: message.route.templateKey,
      title: content.subject ?? "",
      body: content.body,
      createdAt: now,
    });
  });
}

/** The delivery row to send on, or null when it is already done. */
async function claimDelivery(
  db: AppDb,
  now: Date,
  message: Message,
  channel: MessageChannel
): Promise<string | null> {
  const key = deliveryKey(message, channel);
  await db
    .insert(messageDelivery)
    .values({
      id: uuidv7(now),
      ...key,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing({ target: ONCE_TARGET });
  const [row] = await db
    .select({ id: messageDelivery.id, status: messageDelivery.status })
    .from(messageDelivery)
    .where(
      and(
        eq(messageDelivery.eventId, key.eventId),
        eq(messageDelivery.templateKey, key.templateKey),
        eq(messageDelivery.userId, key.userId),
        eq(messageDelivery.channel, key.channel)
      )
    );
  if (!row || row.status === "sent" || row.status === "suppressed") {
    return null;
  }
  return row.id;
}

async function deliverByPort(
  deps: OutboxDeps,
  message: Message,
  channel: "email" | "sms"
): Promise<{ deliveryId: string; error: unknown } | null> {
  const now = deps.clock.now();
  const deliveryId = await claimDelivery(deps.db, now, message, channel);
  if (!deliveryId) return null;
  const content = rendered(message, channel);
  await deps.db
    .update(messageDelivery)
    .set({
      templateVersion: content.version,
      attempts: sql`${messageDelivery.attempts} + 1`,
      updatedAt: now,
    })
    .where(eq(messageDelivery.id, deliveryId));
  try {
    if (channel === "email") {
      await deps.email.send({
        to: message.recipient.email!,
        subject: content.subject ?? "",
        text: content.body,
        html: renderEmailHtml(content.body),
      });
    } else {
      await deps.sms.send({
        to: message.recipient.phone!,
        template: "message",
        dltTemplateId: content.dltTemplateId!,
        vars: message.values,
        text: content.body,
      });
    }
  } catch (error) {
    await deps.db
      .update(messageDelivery)
      .set({ status: "failed", updatedAt: deps.clock.now() })
      .where(eq(messageDelivery.id, deliveryId));
    return { deliveryId, error };
  }
  await deps.db
    .update(messageDelivery)
    .set({ status: "sent", updatedAt: deps.clock.now() })
    .where(eq(messageDelivery.id, deliveryId));
  return null;
}
