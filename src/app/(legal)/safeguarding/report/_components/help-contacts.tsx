import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";

import { CONTACT_LINK, ContactFact } from "@/components/site/contact-fact";
import { contactHref } from "@/lib/contact";
import { isFactShown, SITE } from "@/lib/site";

const CALL = `${CONTACT_LINK} font-semibold`;

const call = (number: string) => (chunks: ReactNode) => (
  <a href={contactHref("phone", number)} className={CALL}>
    {chunks}
  </a>
);

/**
 * Where to get help when a report can't be sent (#116): Childline, 112 and
 * FOA's safeguarding email. Production leaves the email out until FOA
 * confirms it (isFactShown); the helplines always show.
 */
export async function HelpContacts() {
  const t = await getTranslations("safeguardingReport.help");
  return (
    <div>
      <p className="font-semibold">{t("title")}</p>
      <ul className="mt-1 flex list-disc flex-col gap-1 ps-5">
        <li>{t.rich("childline", { childline: call("1098") })}</li>
        <li>{t.rich("emergency", { emergency: call("112") })}</li>
        {isFactShown(SITE.org.email) ? (
          <li>
            {t("email")} <ContactFact kind="email" fact={SITE.org.email} />
          </li>
        ) : null}
      </ul>
    </div>
  );
}
