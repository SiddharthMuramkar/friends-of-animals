import { getTranslations } from "next-intl/server";
import { connection } from "next/server";

import {
  LegalSectionsText,
  LegalShortList,
} from "@/components/legal/legal-text";
import { Disclosure } from "@/components/site/disclosure";
import { cachedConsentDocument } from "@/server/modules/consent/cached";
import { nullIfUnreadable } from "@/server/modules/consent/unreadable";

/**
 * The sign-up form's optional box for news and updates by email (#64).
 * Never ticked to begin with. Its value is the id of the messages consent
 * version shown here, so the consent recorded is to this exact text.
 * Renders nothing while no version is published, or if the database can't
 * be read: the box is optional, so the form stays usable without it. Reads
 * the database, so it sits inside <Suspense>.
 */
export async function MessagesConsentField() {
  await connection();
  const document = await nullIfUnreadable(
    "Sign-up form: could not read the messages consent",
    () => cachedConsentDocument("messages")
  );
  if (!document) return null;
  const t = await getTranslations("auth.form.messagesConsent");

  return (
    <div className="flex flex-col gap-3 rounded-2xl border-2 border-border p-[min(1rem,8%)]">
      <label className="flex min-h-11 items-start gap-3 font-semibold text-ink">
        <input
          type="checkbox"
          name="messagesConsent"
          value={document.id}
          aria-describedby="messages-consent-points"
          className="mt-0.5 size-6 shrink-0 accent-primary"
        />
        <span className="min-w-0">{t("label")}</span>
      </label>
      <LegalShortList
        id="messages-consent-points"
        points={document.body.short}
        className="list-disc space-y-1 pl-5 text-sm text-ink-muted"
      />
      <Disclosure
        summary={t("readFull", { version: document.version })}
        className="rounded-2xl"
      >
        <LegalSectionsText sections={document.body.sections} level="h2" />
      </Disclosure>
    </div>
  );
}
