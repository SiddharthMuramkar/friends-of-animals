// previewAnnouncement({ id }): what an announcement will say and who it
// will reach, before it is sent (#84). It renders the email and the inbox
// message from the current templates for a sample recipient, and counts
// the recipients from the registrations as they are now. It sends nothing
// and writes nothing.

import { and, eq } from "drizzle-orm";

import adminAnnouncements from "../../../../../messages/en-IN/adminAnnouncements.json";
import { authorize } from "../../../access/can";
import type { AppDb } from "../../../db/app-db";
import { messageTemplate } from "../../../db/schema";
import { oneLineSubject } from "../../../ports/email";
import type { UseCaseContext } from "../../../use-cases";
import type { MessageChannel } from "../../notifications/domain/channels";
import { renderTemplate } from "../../notifications/domain/template";
import { DEFAULT_LOCALE } from "../../notifications/locale";
import { loadAnnouncementDeliveryPlan } from "../delivery-plan";
import type { AudiencePlan } from "../domain/audience";
import { announcementValues } from "../render";
import {
  announcementScope,
  contentOf,
  loadAnnouncement,
  loadCompetition,
  type AnnouncementTarget,
} from "./drafts";

/** The template every announcement goes out with. */
export const ANNOUNCEMENT_TEMPLATE = "announcements.announcement";

/** Whose name the preview's greeting uses: nobody real. */
const SAMPLE_RECIPIENT =
  adminAnnouncements.adminAnnouncements.preview.sampleName;

export type AnnouncementPreview = {
  revision: number;
  email: { subject: string; text: string };
  inApp: { title: string; body: string };
  counts: AudiencePlan["counts"];
};

export type PreviewAnnouncementResult =
  | { ok: true; preview: AnnouncementPreview }
  | { ok: false; error: "not_found" };

async function template(db: AppDb, channel: MessageChannel) {
  const [row] = await db
    .select({ subject: messageTemplate.subject, body: messageTemplate.body })
    .from(messageTemplate)
    .where(
      and(
        eq(messageTemplate.key, ANNOUNCEMENT_TEMPLATE),
        eq(messageTemplate.channel, channel),
        eq(messageTemplate.locale, DEFAULT_LOCALE)
      )
    );
  if (!row)
    throw new Error(`Template ${ANNOUNCEMENT_TEMPLATE} has no ${channel}`);
  return row;
}

export async function previewAnnouncement(
  ctx: UseCaseContext,
  input: AnnouncementTarget
): Promise<PreviewAnnouncementResult> {
  await authorize(
    ctx,
    "announcement.manage",
    await announcementScope(ctx.db, input)
  );
  const row = await loadAnnouncement(ctx.db, input);
  if (!row) return { ok: false, error: "not_found" };
  const found = await loadCompetition(ctx.db, row.competitionId);
  if (!found) return { ok: false, error: "not_found" };

  const values = {
    ...announcementValues(found.name, contentOf(ctx.cipher, row)),
    "recipient.name": SAMPLE_RECIPIENT,
  };
  const smsEnabled = await ctx.settings.get("sms.enabled");
  const [email, inApp, plan] = await Promise.all([
    template(ctx.db, "email"),
    template(ctx.db, "in_app"),
    loadAnnouncementDeliveryPlan(
      ctx,
      row.competitionId,
      row.sentAt ?? ctx.clock.now(),
      smsEnabled
    ),
  ]);
  const subject = (source: string | null) =>
    source === null ? "" : oneLineSubject(renderTemplate(source, values));
  return {
    ok: true,
    preview: {
      revision: row.revision,
      email: {
        subject: subject(email.subject),
        text: renderTemplate(email.body, values),
      },
      inApp: {
        title: subject(inApp.subject),
        body: renderTemplate(inApp.body, values),
      },
      counts: plan.counts,
    },
  };
}
