// What a breach's notices may say (#116), for #69's dispatcher and the
// authority's email.
//
// A notice to an affected person says only whose data it involved: the
// person's own, a child's they look after, or both. Nothing of the breach
// itself (its title, impact or notes) goes into a message or the outbox:
// FOA's counsel approves the wording before production use, and staff edit
// the seeded drafts as message templates (HR-49, HR-50).
//
// The authority's email gives the facts the authority asks for first: when
// FOA became aware, how severe, how many people, whether children and
// personal data are involved, and the title staff gave it. The impact is
// sent by FOA's breach lead in the full report, not by this email.
//
// Words come from messages/en-IN/adminBreaches.json, like every other copy.
// A missing key fails the delivery loudly rather than mailing the key path.
//
// Loads under plain Node (the worker): relative imports only.

import { createFormatter, createTranslator } from "next-intl";

import adminBreaches from "../../../../messages/en-IN/adminBreaches.json";
import { formats, LOCALE } from "../../../i18n/formats";
import type { FieldCipher } from "../../crypto/field-cipher";
import type { BreachRecordRow } from "../../db/schema";
import { openBreachText } from "./content";
import type { NoticeRecipientRole } from "./domain/notice-recipients";

function refuseFallback(error: Error): never {
  throw error;
}

const words = createTranslator({
  locale: LOCALE,
  messages: adminBreaches,
  namespace: "adminBreaches",
  onError: refuseFallback,
});

const format = createFormatter({ locale: LOCALE, formats });

export const PRINCIPAL_NOTICE = "breach.principal_notice";
export const PRINCIPAL_NOTICE_AUDIENCE = "breach_recipient";
export const PRINCIPAL_NOTICE_CHANNELS = ["email", "in_app"] as const;

/** The variables a notice to an affected person may use. */
export const PRINCIPAL_NOTICE_VARIABLES = ["breach.about"] as const;

/** Whose data the notice is about, as a phrase: "your personal data". */
export function principalNoticeValues(notice: {
  as: NoticeRecipientRole;
  aboutCount: number;
}): Record<string, string> {
  // Told about themselves and children: the children are the rest.
  const children =
    notice.as === "principal_and_guardian"
      ? notice.aboutCount - 1
      : notice.aboutCount;
  return {
    "breach.about": words(`notices.about.${notice.as}`, { count: children }),
  };
}

/** The variables the authority's email may use. */
export const AUTHORITY_NOTICE_VARIABLES = [
  "breach.title",
  "breach.awareAt",
  "breach.severity",
  "breach.affectedCount",
  "breach.minorsAffected",
  "breach.personalDataInvolved",
] as const;

/** The breach's facts for the authority's email. */
export function authorityNoticeValues(
  cipher: FieldCipher,
  row: BreachRecordRow
): Record<string, string> {
  const yesNo = (value: boolean) => words(value ? "notices.yes" : "notices.no");
  return {
    "breach.title": openBreachText(cipher, "title", row.title),
    "breach.awareAt": format.dateTime(row.awareAt, "longDateTime"),
    "breach.severity": words(`severities.${row.severity}`),
    "breach.affectedCount": format.number(row.affectedCount),
    "breach.minorsAffected": yesNo(row.minorsAffected),
    "breach.personalDataInvolved": yesNo(row.personalDataInvolved),
  };
}
