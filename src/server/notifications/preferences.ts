// A user's channel choices (#69): email, SMS or both. In-app is the
// inbox, always on. Messages the law requires ignore these choices
// (src/server/notifications/domain/delivery-plan.ts), and SMS goes only
// while `sms.enabled` is on and its template is DLT-registered.
//
//   getNotificationPreferences()                  → { email, sms }
//   updateNotificationPreferences({ email, sms }) → saved; not both off

import { z } from "zod";

import { authorize } from "../access/can";
import { notificationPreference } from "../db/schema";
import type { InvalidInput } from "../input";
import type { UseCaseContext } from "../use-cases";
import { preferencesOf } from "./dispatch";

export type NotificationPreferences = { email: boolean; sms: boolean };

export type UpdateNotificationPreferencesResult =
  | { ok: true; preferences: NotificationPreferences }
  | InvalidInput;

const preferencesInput = z.object({ email: z.boolean(), sms: z.boolean() });

/** The signed-in user's id; `authorize` has ruled out other actors. */
function ownerId(ctx: UseCaseContext): string {
  if (ctx.actor.kind !== "user") throw new Error("unreachable");
  return ctx.actor.userId;
}

export async function getNotificationPreferences(
  ctx: UseCaseContext
): Promise<NotificationPreferences> {
  await authorize(ctx, "notification_preference.view");
  return preferencesOf(ctx.db, ownerId(ctx));
}

export async function updateNotificationPreferences(
  ctx: UseCaseContext,
  input: NotificationPreferences
): Promise<UpdateNotificationPreferencesResult> {
  await authorize(ctx, "notification_preference.edit");
  const userId = ownerId(ctx);
  const parsed = preferencesInput.safeParse(input);
  if (!parsed.success) {
    const fields = new Set(parsed.error.issues.map((i) => String(i.path[0])));
    return { ok: false, error: "invalid_input", fields: [...fields] };
  }
  const preferences = parsed.data;
  // Email, SMS or both: someone who wants no messages withdraws their
  // consent to messages (#64) instead.
  if (!preferences.email && !preferences.sms) {
    return { ok: false, error: "invalid_input", fields: ["email", "sms"] };
  }
  const now = ctx.clock.now();
  await ctx.db
    .insert(notificationPreference)
    .values({ userId, ...preferences, updatedAt: now })
    .onConflictDoUpdate({
      target: notificationPreference.userId,
      set: { ...preferences, updatedAt: now },
    });
  return { ok: true, preferences };
}
