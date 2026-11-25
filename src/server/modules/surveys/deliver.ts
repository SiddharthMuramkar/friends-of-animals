import { and, eq } from "drizzle-orm";
import {
  survey,
  surveyInvitation,
  messageRoute,
  messageTemplate,
} from "../../db/schema";
import type { Delivery, OutboxDeps } from "../../outbox/handlers";
import {
  deliverToAccount,
  preferencesOf,
  recipientOf,
} from "../notifications/dispatch";
import { planDelivery } from "../notifications/domain/delivery-plan";
import { DEFAULT_LOCALE } from "../notifications/locale";
import { surveyAudience } from "./audience";
import { isOpen, publicationExists } from "./eligibility";
import { feedbackPath } from "../../../lib/app-routes";
import { surveyToken } from "./token";

export async function deliverSurveyInvitation(
  deps: OutboxDeps,
  delivery: Delivery<"survey.invitation_due">
) {
  const [found] = await deps.db
    .select({ row: survey, invitation: surveyInvitation })
    .from(surveyInvitation)
    .innerJoin(survey, eq(survey.id, surveyInvitation.surveyId))
    .where(eq(surveyInvitation.id, delivery.payload.invitationId));
  if (!found || found.invitation.status !== "queued") return;
  const { row, invitation } = found;
  const settle = async (status: "sent" | "skipped") =>
    deps.db
      .update(surveyInvitation)
      .set({ status })
      .where(
        and(
          eq(surveyInvitation.id, invitation.id),
          eq(surveyInvitation.status, "queued")
        )
      );
  if (
    invitation.answeredAt ||
    !isOpen(row, deps.clock.now()) ||
    !(await deps.settings.get("surveys.enabled")) ||
    !(await publicationExists(deps.db, row.competitionId, deps.clock.now())) ||
    !(
      await surveyAudience(deps, row.competitionId, invitation.userId)
    ).includes(invitation.userId)
  ) {
    await settle("skipped");
    return;
  }
  const recipient = await recipientOf(deps, invitation.userId);
  if (!recipient) {
    await settle("skipped");
    return;
  }
  const [route] = await deps.db
    .select()
    .from(messageRoute)
    .where(
      and(
        eq(messageRoute.eventType, "survey.invitation_due"),
        eq(messageRoute.templateKey, "surveys.invitation"),
        eq(messageRoute.enabled, true)
      )
    );
  if (!route) throw new Error("No survey invitation route enabled");
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
    throw new Error("Survey notification templates missing");
  if (!deps.auth.baseUrl) throw new Error("Survey invitation requires APP_URL");
  const channels = route.channels.filter((c) => c !== "sms");
  const plan = planDelivery({
    routeChannels: channels,
    requiredByLaw: false,
    preferences: await preferencesOf(deps.db, invitation.userId),
    messagesConsent: true,
    smsEnabled: false,
    smsTemplateRegistered: false,
    contact: { email: recipient.email !== null, verifiedPhone: false },
  });
  const url = new URL(
    feedbackPath(surveyToken(deps.blindIndex, invitation.id).token),
    deps.auth.baseUrl
  ).href;
  const failures = await deliverToAccount(
    deps,
    {
      delivery,
      route: { ...route, channels },
      templates,
      recipient,
      values: {
        "survey.title": row.title,
        "survey.link": url,
        "recipient.name": recipient.name,
      },
    },
    plan
  );
  if (failures.length) throw failures[0]!.error;
  await settle("sent");
}
