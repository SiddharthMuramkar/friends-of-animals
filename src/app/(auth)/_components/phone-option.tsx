import { getTranslations } from "next-intl/server";

import { inlineLink } from "@/components/site/link-styles";
import { SiteLink } from "@/components/site/site-link";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";

/**
 * The way to the phone form, under the email form, while SMS is on; while
 * it is off there is nothing to offer, so nothing shows. Reads the setting
 * per request: render it inside <Suspense>.
 */
export async function PhoneOption({
  intent,
}: {
  intent: "sign-up" | "sign-in";
}) {
  const [methods, t] = await Promise.all([
    currentActor().then((actor) => as(actor).signInMethods()),
    getTranslations("authPhone.option"),
  ]);
  if (!methods.phone) return null;
  const phone = intent === "sign-up" ? ROUTES.signUpPhone : ROUTES.signInPhone;
  return (
    <p className="mt-6">
      <SiteLink href={phone.path} className={inlineLink}>
        {intent === "sign-up" ? t("signUp") : t("signIn")}
      </SiteLink>
    </p>
  );
}
