import { and, eq } from "drizzle-orm";
import {
  competitionInvitation,
  messageRoute,
  messageTemplate,
  user,
} from "../../db/schema";
import type { Delivery, OutboxDeps } from "../../outbox/handlers";
import {
  deliverToAccount,
  preferencesOf,
  recipientOf,
} from "../notifications/dispatch";
import { planDelivery } from "../notifications/domain/delivery-plan";
import { DEFAULT_LOCALE } from "../notifications/locale";
import { currentRecipient } from "./eligibility";
import { DASHBOARD_INVITATIONS } from "../../../lib/app-routes";

export async function deliverCompetitionInvitation(
  deps: OutboxDeps,
  delivery: Delivery<"competition_invitation.due">
) {
  const [invite] = await deps.db
    .select()
    .from(competitionInvitation)
    .where(eq(competitionInvitation.id, delivery.payload.invitationId));
  if (!invite || invite.status !== "queued") return;
  const settle = async (status: "sent" | "skipped") =>
    deps.db
      .update(competitionInvitation)
      .set({ status })
      .where(
        and(
          eq(competitionInvitation.id, invite.id),
          eq(competitionInvitation.status, "queued")
        )
      );
  const eligible = await currentRecipient(deps, invite);
  if (!eligible) {
    await settle("skipped");
    return;
  }
  const [account] = await deps.db
    .select({ verified: user.emailVerified })
    .from(user)
    .where(eq(user.id, eligible.userId));
  const recipient = await recipientOf(deps, eligible.userId);
  if (!recipient || !account) {
    await settle("skipped");
    return;
  }
  const [route] = await deps.db
    .select()
    .from(messageRoute)
    .where(
      and(
        eq(messageRoute.eventType, "competition_invitation.due"),
        eq(messageRoute.templateKey, "competition_invitations.invitation"),
        eq(messageRoute.enabled, true)
      )
    );
  if (!route)
    throw Error("Competition invitation notification route not enabled");
  const templates = Object.fromEntries(
    (
      await deps.db
        .select()
        .from(messageTemplate)
        .where(
          and(
            eq(messageTemplate.key, route.templateKey),
            eq(messageTemplate.locale, DEFAULT_LOCALE)
          )
        )
    ).map((r) => [r.channel, r])
  );
  if (!templates.email || !templates.in_app)
    throw Error("Competition invitation notification templates missing");
  if (!deps.auth.baseUrl)
    throw Error("Competition invitation requires APP_URL");
  if (!account.verified) recipient.email = null;
  const channels = route.channels.filter((c) => c !== "sms");
  const plan = planDelivery({
    routeChannels: channels,
    requiredByLaw: false,
    preferences: await preferencesOf(deps.db, recipient.id),
    messagesConsent: true,
    smsEnabled: false,
    smsTemplateRegistered: false,
    contact: { email: recipient.email !== null, verifiedPhone: false },
  });
  // No child name or identifier is copied into the external message or link.
  // The authenticated recipient chooses their invitation on the private page.
  if (!(await currentRecipient(deps, invite))) {
    await settle("skipped");
    return;
  }
  const failures = await deliverToAccount(
    deps,
    {
      delivery,
      route: { ...route, channels },
      templates,
      recipient,
      values: {
        "invitation.link": new URL(DASHBOARD_INVITATIONS, deps.auth.baseUrl)
          .href,
      },
    },
    plan
  );
  if (failures.length) throw failures[0]!.error;
  await settle("sent");
}
