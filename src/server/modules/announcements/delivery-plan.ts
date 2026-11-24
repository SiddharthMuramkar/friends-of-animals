// The enabled routes and available channels used by preview, send and
// fan-out (#84). The audience comes from loadAnnouncementAudience; this
// file decides, per contact, which of the announcement's routes and
// channels reach them, so the counts a manager sees are the people the
// fan-out sends to.
//
// Loads under plain Node (the worker): relative imports only. It stays
// clear of the dispatcher, whose audiences import message files: the seed
// and the Playwright journey load this file through the seed.

import { and, asc, eq, inArray } from "drizzle-orm";

import type { AppDb } from "../../db/app-db";
import { messageRoute, messageTemplate } from "../../db/schema";
import {
  planServiceDelivery,
  type ContactMessage,
} from "../notifications/contact-delivery";
import { DEFAULT_LOCALE } from "../notifications/locale";
import type { Contact } from "./domain/audience";
import { loadAnnouncementAudience } from "./load-audience";

/** The route audience each kind of contact is reached through. */
const AUDIENCE = {
  account: "announcement_registrants",
  details: "announcement_contacts",
} as const;

/** A template key's rows in the default locale, by channel. */
async function templatesFor(
  db: AppDb,
  key: string
): Promise<ContactMessage["templates"]> {
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

export async function loadAnnouncementDeliveryPlan(
  deps: Parameters<typeof loadAnnouncementAudience>[0],
  competitionId: string,
  at: Date,
  smsEnabled: boolean,
  registrationIds?: ReadonlySet<string>
) {
  const routes = await deps.db
    .select()
    .from(messageRoute)
    .where(
      and(
        eq(messageRoute.eventType, "competition.announcement_sent"),
        inArray(messageRoute.audience, Object.values(AUDIENCE)),
        eq(messageRoute.enabled, true)
      )
    )
    .orderBy(asc(messageRoute.templateKey), asc(messageRoute.audience));
  const templateKeys = [...new Set(routes.map((route) => route.templateKey))];
  const templatesByKey = new Map(
    await Promise.all(
      templateKeys.map(async (key) => {
        const templates = await templatesFor(deps.db, key);
        if (!templates.email || !templates.in_app) {
          throw new Error(`Template ${key} lacks email or in-app`);
        }
        return [key, templates] as const;
      })
    )
  );
  const plansFor = (contact: Contact) =>
    routes
      .filter((route) => route.audience === AUDIENCE[contact.kind])
      .map((route) => {
        const templates = templatesByKey.get(route.templateKey)!;
        const { email, phone } = contact;
        const plan = planServiceDelivery(
          { route, templates, email, phone },
          smsEnabled,
          contact.kind === "account" ? contact.preferences : undefined
        );
        return { route, templates, email, phone, plan };
      });

  const audience = await loadAnnouncementAudience(deps, {
    competitionId,
    at,
    registrationIds,
    channelsForContact: (contact) => [
      ...new Set(plansFor(contact).flatMap(({ plan }) => plan.deliver)),
    ],
  });
  return {
    counts: audience.counts,
    deliveries: audience.recipients.flatMap((recipient) =>
      plansFor(recipient.contact).map((delivery) => ({
        recipient,
        ...delivery,
      }))
    ),
  };
}
