import { getTranslations } from "next-intl/server";

import { Callout } from "@/components/site/callout";
import { inlineLink } from "@/components/site/link-styles";
import { SiteLink } from "@/components/site/site-link";
import { ROUTES } from "@/lib/routes";

/**
 * Shown in place of the phone form while SMS is switched off: codes come
 * by email, and here is the way in by email. /styleguide shows it too, so
 * axe checks what staging and production show until DLT approval.
 */
export async function SmsOffCallout({
  intent,
  className,
}: {
  intent: "sign-up" | "sign-in";
  className?: string;
}) {
  const t = await getTranslations("authPhone.off");
  const email = intent === "sign-up" ? ROUTES.signUp : ROUTES.signIn;
  return (
    <Callout tone="info" className={className}>
      <p>{t("message")}</p>
      <p>
        <SiteLink href={email.path} className={inlineLink}>
          {intent === "sign-up" ? t("signUp") : t("signIn")}
        </SiteLink>
      </p>
    </Callout>
  );
}
