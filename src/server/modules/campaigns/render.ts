// What a campaign message says (#126): the `campaigns.message` template
// (drizzle/*_126_campaign_messages.sql, edited at /admin/templates) filled
// with the campaign's subject and body and the recipient's name, then the
// withdrawal notice with the recipient's own link. The notice is added
// here, after the editable wording, so no edit can leave a message without
// a way out. Everything is plain text: #69's renderer escapes it for the
// email's HTML part.
//
// Loads under plain Node (the worker): relative imports only.

import { and, eq } from "drizzle-orm";
import { createTranslator } from "next-intl";

import campaignsMessages from "../../../../messages/en-IN/campaigns.json";
import { LOCALE } from "../../../i18n/formats";
import type { AppDb } from "../../db/app-db";
import {
  campaign,
  messageTemplate,
  type MessageTemplateRow,
} from "../../db/schema";
import type { MessageChannel } from "../notifications/domain/channels";
import { renderTemplate } from "../notifications/domain/template";
import { DEFAULT_LOCALE } from "../notifications/locale";

export const CAMPAIGN_TEMPLATE = "campaigns.message";

/** The variables the campaign template may use, beyond the recipient's. */
export const CAMPAIGN_VARIABLES = [
  "campaign.subject",
  "campaign.body",
] as const;

/** Filled by code after the editable wording; never a template variable. */
const NOTICE_VARIABLE = "withdrawal.notice";

// A missing string fails the delivery loudly rather than mailing the key.
function refuseFallback(error: Error): never {
  throw error;
}
const t = createTranslator({
  locale: LOCALE,
  messages: campaignsMessages,
  namespace: "campaigns.message",
  onError: refuseFallback,
});

export type CampaignTemplates = Partial<
  Record<MessageChannel, MessageTemplateRow>
>;

/** The template's rows in the default locale, by channel. */
export async function campaignTemplates(db: AppDb): Promise<CampaignTemplates> {
  const rows = await db
    .select()
    .from(messageTemplate)
    .where(
      and(
        eq(messageTemplate.key, CAMPAIGN_TEMPLATE),
        eq(messageTemplate.locale, DEFAULT_LOCALE)
      )
    );
  return Object.fromEntries(rows.map((row) => [row.channel, row]));
}

/** Each template with the withdrawal notice after its wording. */
export function withNotice(templates: CampaignTemplates): CampaignTemplates {
  return Object.fromEntries(
    Object.entries(templates).map(([channel, row]) => [
      channel,
      { ...row, body: `${row.body}\n\n{{${NOTICE_VARIABLE}}}` },
    ])
  );
}

/** The values one recipient's message fills in. */
export function campaignValues(
  content: { subject: string; body: string },
  recipient: { name: string; withdrawalUrl: string }
): Record<string, string> {
  return {
    "campaign.subject": content.subject,
    "campaign.body": content.body,
    "recipient.name": recipient.name,
    [NOTICE_VARIABLE]: t("withdrawalNotice", { url: recipient.withdrawalUrl }),
  };
}

/** The values the dispatcher's catalogue reads for a campaign's event. */
export async function campaignEventValues(
  db: AppDb,
  campaignId: string
): Promise<Record<string, string>> {
  const [row] = await db
    .select({ subject: campaign.subject, body: campaign.body })
    .from(campaign)
    .where(eq(campaign.id, campaignId));
  return row
    ? { "campaign.subject": row.subject, "campaign.body": row.body }
    : {};
}

/** One channel's message as the recipient would read it. */
export function renderCampaign(
  templates: CampaignTemplates,
  channel: "email" | "in_app",
  values: Record<string, string>
): { subject: string; body: string } {
  const row = withNotice(templates)[channel];
  if (!row) throw new Error(`Template ${CAMPAIGN_TEMPLATE} lacks ${channel}`);
  return {
    subject: row.subject === null ? "" : renderTemplate(row.subject, values),
    body: renderTemplate(row.body, values),
  };
}
