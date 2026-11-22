import { getTranslations } from "next-intl/server";

import { Callout } from "@/components/site/callout";
import { inlineLink } from "@/components/site/link-styles";
import { SiteLink } from "@/components/site/site-link";
import { ROUTES } from "@/lib/routes";

/**
 * Shown in place of the code form while email sign-in is off: switched off
 * on the settings screen, or in production until SES can send to anyone
 * (DECISIONS R-27). It says sign-in opens soon and offers no form or
 * button, only what is open meanwhile. /styleguide shows it too, so axe
 * checks what production shows until then.
 */
export async function EmailOffCallout({
  intent,
  className,
}: {
  intent: "sign-up" | "sign-in";
  className?: string;
}) {
  const t = await getTranslations("auth.off");
  return (
    <Callout tone="info" className={className}>
      <p>
        <strong>{intent === "sign-up" ? t("signUp") : t("signIn")}</strong>{" "}
        {t("message")}
      </p>
      <p>
        <SiteLink href={ROUTES.competitions.path} className={inlineLink}>
          {t("competitions")}
        </SiteLink>
        {" · "}
        <SiteLink href={ROUTES.contact.path} className={inlineLink}>
          {t("contact")}
        </SiteLink>
      </p>
    </Callout>
  );
}
